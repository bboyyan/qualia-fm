import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TasteLedgerFileSchema, trackKeyOf, type LedgerEntry } from '@qualia/contracts';
import {
  MAX_AIRED_ENTRIES,
  TasteLedger,
  TasteLedgerError,
  filePersistence,
  memoryPersistence,
  reduceMarks,
  type TastePersistence,
} from '../src/ledger/tasteStore.js';
import { applyTasteRules } from '../src/services/tasteRules.js';

const track = (title: string, artist = 'TEST Artist') => ({ trackKey: trackKeyOf(artist, title), title, artist });
const at = (minute: number): string => new Date(Date.UTC(2026, 9, 5, 12, minute)).toISOString();
const rating = (id: string, title: string, minute: number, value: '愛' | '還行' | '不對', note = ''): LedgerEntry =>
  ({ kind: 'rating', entryId: `TEST-entry-${id}`, at: at(minute), ...track(title), rating: value, note });
const mark = (id: string, title: string, minute: number, value: 'pinned' | 'blocked' | null): LedgerEntry =>
  ({ kind: 'mark', entryId: `TEST-entry-${id}`, at: at(minute), ...track(title), mark: value });
const aired = (id: string, title: string, minute: number): LedgerEntry =>
  ({ kind: 'aired', entryId: `TEST-entry-${id}`, at: at(minute), ...track(title), showId: 'TEST-show' });
const tempPath = (): string => join(mkdtempSync(join(tmpdir(), 'qualia-taste-')), 'nested', 'taste-ledger.json');

describe('trackKeyOf', () => {
  it('同一首歌的大小寫、全半形與多餘空白視為同一首', () => {
    expect(trackKeyOf('Evan  Call ', 'Time Flows Ever Onward')).toBe(trackKeyOf('evan call', 'ＴＩＭＥ flows ever onward'));
    expect(trackKeyOf('A', 'B')).not.toBe(trackKeyOf('B', 'A'));
  });
});

describe('reduceMarks', () => {
  it('後到的評價與標記覆蓋先前的；播出只更新 lastAiredAt；空短評視為沒有', () => {
    const marks = reduceMarks([
      rating('r1', 'Song A', 1, '愛', '低頻很暖'),
      mark('m1', 'Song A', 2, 'pinned'),
      aired('a1', 'Song A', 3),
      rating('r2', 'Song A', 4, '不對', ''),
      mark('m2', 'Song B', 5, 'blocked'),
      mark('m3', 'Song B', 6, null),
    ]);
    expect(marks).toEqual([
      { ...track('Song A'), mark: 'pinned', rating: '不對', note: null, lastAiredAt: at(3), updatedAt: at(4) },
      { ...track('Song B'), mark: null, rating: null, note: null, lastAiredAt: null, updatedAt: at(6) },
    ]);
  });
});

describe('TasteLedger 讀寫', () => {
  it('首次使用（檔案不存在）視為空帳本', async () => {
    const ledger = new TasteLedger(filePersistence(tempPath()));
    expect(await ledger.snapshot()).toEqual({ marks: [], recentAired: [] });
  });

  it('寫入本機檔（機器可讀、權限 600），重開後讀回相同狀態', async () => {
    const path = tempPath();
    await new TasteLedger(filePersistence(path)).record([rating('r1', 'Song A', 1, '愛', '想多聽'), mark('m1', 'Song B', 2, 'blocked'), aired('a1', 'Song C', 3)]);
    const file = TasteLedgerFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    expect(file.entries.map((entry) => entry.entryId)).toEqual(['TEST-entry-r1', 'TEST-entry-m1', 'TEST-entry-a1']);
    expect(file.marks.map((m) => [m.title, m.mark, m.rating, m.note])).toEqual([['Song A', null, '愛', '想多聽'], ['Song B', 'blocked', null, null], ['Song C', null, null, null]]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const reopened = await new TasteLedger(filePersistence(path)).snapshot();
    expect(reopened.marks).toEqual(file.marks);
    expect(reopened.recentAired).toEqual([track('Song C').trackKey]);
  });

  it('同一 entryId 重送只記一筆（冪等），且不再寫檔', async () => {
    let saves = 0;
    let body: string | null = null;
    const ledger = new TasteLedger({ load: () => body, save: (next) => { saves += 1; body = next; } });
    await ledger.record([rating('r1', 'Song A', 1, '愛')]);
    await ledger.record([rating('r1', 'Song A', 1, '愛'), rating('r1', 'Song A', 1, '愛')]);
    expect(saves).toBe(1);
    expect(TasteLedgerFileSchema.parse(JSON.parse(body!)).entries).toHaveLength(1);
  });

  it('recentAired 新到舊、不重複', async () => {
    const ledger = new TasteLedger(memoryPersistence());
    await ledger.record([aired('a1', 'Song A', 1), aired('a2', 'Song B', 2), aired('a3', 'Song A', 3)]);
    expect((await ledger.snapshot()).recentAired).toEqual([track('Song A').trackKey, track('Song B').trackKey]);
  });

  it(`播出紀錄超過 ${MAX_AIRED_ENTRIES} 筆時丟最舊的，評價與標記保留`, async () => {
    const ledger = new TasteLedger(memoryPersistence());
    await ledger.record([rating('r0', 'Song 0', 0, '愛'), aired('a-old', 'Song 0', 0)]);
    await ledger.record(Array.from({ length: MAX_AIRED_ENTRIES }, (_, i) => aired(`a${i}`, `Song ${i + 1}`, i + 1)));
    const snapshot = await ledger.snapshot();
    expect(snapshot.recentAired).toHaveLength(MAX_AIRED_ENTRIES);
    expect(snapshot.recentAired).not.toContain(track('Song 0').trackKey);
    expect((await ledger.find(track('Song 0').trackKey))?.rating).toBe('愛');
  });

  it('修剪後仍保留 pinned 播出時間，重啟與後續寫入不會改壞釘選排序', async () => {
    const path = tempPath();
    const ledger = new TasteLedger(filePersistence(path));
    await ledger.record([
      mark('never', 'Never pin', 0, 'pinned'),
      mark('older', 'Older pin', 1, 'pinned'), aired('older-air', 'Older pin', 2),
      aired('old-air', 'Old pin', 3), mark('old', 'Old pin', 4, 'pinned'),
    ]);
    await ledger.record(Array.from({ length: MAX_AIRED_ENTRIES }, (_, i) => aired(`new-${i}`, `Song ${i}`, i + 10)));
    expect((await ledger.find(track('Old pin').trackKey))?.lastAiredAt).toBe(at(3));
    const reopened = new TasteLedger(filePersistence(path));
    expect((await reopened.find(track('Old pin').trackKey))?.lastAiredAt).toBe(at(3));
    // 遲到的舊播出事件與新的評價都不能抹掉最近一次播出。
    await reopened.record([aired('late-old-air', 'Old pin', -1), rating('later-rating', 'Old pin', 600, '愛')]);
    const snapshot = await new TasteLedger(filePersistence(path)).snapshot();
    expect(snapshot.marks.find((item) => item.title === 'Old pin')).toMatchObject({ lastAiredAt: at(3), rating: '愛' });
    expect(snapshot.recentAired).toHaveLength(MAX_AIRED_ENTRIES);
    expect(snapshot.recentAired).not.toContain(track('Old pin').trackKey);
    expect(applyTasteRules([], snapshot, { target: 2 }).candidates.map((item) => item.title)).toEqual(['Never pin', 'Older pin']);
  });
});

describe('TasteLedger 失敗明示（不靜默、不覆寫）', () => {
  it.each(['TEST corrupt JSON', '{"version":1,"entries":[],"marks":[{}]}'])('載入後損毀仍拒絕讀寫，保留原檔並可在修復後恢復：%s', async (corrupt) => {
    const path = tempPath();
    const ledger = new TasteLedger(filePersistence(path));
    await ledger.record([mark('m1', 'Song A', 1, 'pinned')]);
    await ledger.snapshot();
    const good = readFileSync(path, 'utf8');
    writeFileSync(path, corrupt);
    await expect(ledger.record([mark('m2', 'Song B', 2, 'pinned')])).rejects.toMatchObject({ failure: 'corrupt' });
    expect(readFileSync(path, 'utf8')).toBe(corrupt);
    await expect(ledger.snapshot()).rejects.toMatchObject({ failure: 'corrupt' });
    await expect(ledger.marks()).rejects.toMatchObject({ failure: 'corrupt' });
    await expect(ledger.find(track('Song A').trackKey)).rejects.toMatchObject({ failure: 'corrupt' });
    writeFileSync(path, good);
    await ledger.record([mark('m2', 'Song B', 2, 'pinned')]);
    expect((await ledger.marks()).map((item) => item.title)).toEqual(['Song A', 'Song B']);
  });

  it('損毀檔：讀取丟 corrupt，寫入也拒絕且原檔不被覆寫', async () => {
    const path = tempPath();
    await new TasteLedger(filePersistence(path)).record([rating('r1', 'Song A', 1, '愛')]);
    writeFileSync(path, '{"version":1,"entries":[{"kind":"rating"}]', 'utf8');
    const ledger = new TasteLedger(filePersistence(path));
    await expect(ledger.snapshot()).rejects.toMatchObject({ name: 'TasteLedgerError', failure: 'corrupt' });
    await expect(ledger.record([rating('r2', 'Song B', 2, '還行')])).rejects.toBeInstanceOf(TasteLedgerError);
    expect(readFileSync(path, 'utf8')).toBe('{"version":1,"entries":[{"kind":"rating"}]');
  });

  it('修好檔案後下次呼叫自動恢復（不必重啟）', async () => {
    const path = tempPath();
    await new TasteLedger(filePersistence(path)).record([rating('r1', 'Song A', 1, '愛')]);
    const good = readFileSync(path, 'utf8');
    writeFileSync(path, 'not json', 'utf8');
    const ledger = new TasteLedger(filePersistence(path));
    await expect(ledger.snapshot()).rejects.toMatchObject({ failure: 'corrupt' });
    writeFileSync(path, good, 'utf8');
    expect((await ledger.snapshot()).marks).toHaveLength(1);
  });

  it('讀檔例外（非 ENOENT）丟 unreadable', async () => {
    const ledger = new TasteLedger({ load: () => { throw Object.assign(new Error('TEST EACCES'), { code: 'EACCES' }); }, save: () => undefined });
    await expect(ledger.snapshot()).rejects.toMatchObject({ failure: 'unreadable' });
  });

  it('寫入失敗丟 write，記憶體狀態不前進（不會假裝已記下）', async () => {
    let fail = false;
    let saved: string | null = null;
    const persistence: TastePersistence = {
      load: () => saved,
      save: (body) => { if (fail) throw new Error('TEST disk full'); saved = body; },
    };
    const ledger = new TasteLedger(persistence);
    await ledger.record([rating('r1', 'Song A', 1, '愛')]);
    fail = true;
    await expect(ledger.record([mark('m1', 'Song A', 2, 'blocked')])).rejects.toMatchObject({ failure: 'write' });
    expect((await ledger.find(track('Song A').trackKey))?.mark).toBeNull();
    fail = false;
    await ledger.record([mark('m1', 'Song A', 2, 'blocked')]);
    expect((await ledger.find(track('Song A').trackKey))?.mark).toBe('blocked');
  });
});
