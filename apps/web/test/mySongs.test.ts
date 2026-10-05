/**
 * BRA-135「我的歌」：純函式（濾鏡／搜尋／排序／釘選名額／文字）、狀態模型（接帳本 API）、
 * 當種子開台的請求，以及頁面的靜態輸出（沒有模式列／假帳本／TEST 雜訊）。
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PINNED_LIMIT, PlanRequestSchema, trackKeyOf, type LedgerEntry, type TrackMark } from '@qualia/contracts';
import { ApiError, localError } from '../src/api/client';
import { songSeedRequest } from '../src/features/seed/seedList';
import { DEFAULT_SETTINGS } from '../src/features/settings/settings';
import {
  PIN_FULL_MESSAGE,
  RECENT_DAYS,
  doneMessage,
  editFor,
  emptyMessage,
  entryLabel,
  entryNote,
  isLoved,
  pinState,
  ratingSummary,
  visibleSongs,
} from '../src/features/songs/mySongs';
import { MySongsModel, type SongsApi } from '../src/features/songs/mySongsModel';
import { MySongsPage } from '../src/features/songs/MySongsPage';
import { SongRow } from '../src/features/songs/SongRow';

const NOW = Date.parse('2026-10-05T12:00:00.000Z');
const daysAgo = (days: number): string => new Date(NOW - days * 86_400_000).toISOString();

function song(title: string, patch: Partial<TrackMark> = {}): TrackMark {
  const artist = patch.artist ?? '夜行者';
  return { trackKey: trackKeyOf(artist, title), title, artist, mark: null, rating: null, note: null, lastAiredAt: null, updatedAt: daysAgo(1), ...patch };
}

const LIBRARY: TrackMark[] = [
  song('遠方的燈', { rating: '愛', note: '很溫暖', updatedAt: daysAgo(3) }),
  song('霧中電車', { mark: 'pinned', updatedAt: daysAgo(30) }),
  song('城市換氣', { mark: 'blocked', rating: '愛', updatedAt: daysAgo(0.5) }),
  song('Ｍｏｏｎ　Ｒｉｖｅｒ', { artist: 'Ａｕｒｏｒａ', rating: '不對', updatedAt: daysAgo(20), lastAiredAt: daysAgo(2) }),
  song('慢慢醒來', { rating: '還行', updatedAt: daysAgo(40) }),
];
const titles = (songs: readonly TrackMark[]): string[] => songs.map((item) => item.title);

describe('濾鏡、搜尋與排序', () => {
  it('全部：釘選在最前、封鎖沉底，其餘依最近動到的先（評價或播出取較新）', () => {
    expect(titles(visibleSongs(LIBRARY, { filter: 'all', query: '' }, NOW))).toEqual(['霧中電車', 'Ｍｏｏｎ　Ｒｉｖｅｒ', '遠方的燈', '慢慢醒來', '城市換氣']);
  });

  it('收藏＝評價「愛」或已釘選；封鎖的不算收藏', () => {
    expect(titles(visibleSongs(LIBRARY, { filter: 'loved', query: '' }, NOW))).toEqual(['霧中電車', '遠方的燈']);
  });

  it.each([null, '還行', '不對', '愛'] as const)('釘選歌的收藏按鈕只看評價：%s', (rating) => {
    expect(isLoved(song('釘選歌', { mark: 'pinned', rating }))).toBe(rating === '愛');
  });

  it('封鎖只列封鎖的歌', () => {
    expect(titles(visibleSongs(LIBRARY, { filter: 'blocked', query: '' }, NOW))).toEqual(['城市換氣']);
  });

  it(`最近：${RECENT_DAYS} 天內有評價／標記或播出（播出時間較新時以播出為準），依時間排`, () => {
    expect(titles(visibleSongs(LIBRARY, { filter: 'recent', query: '' }, NOW))).toEqual(['城市換氣', 'Ｍｏｏｎ　Ｒｉｖｅｒ', '遠方的燈']);
  });

  it('搜尋曲名或藝人，不分全半形、大小寫與多餘空白', () => {
    expect(titles(visibleSongs(LIBRARY, { filter: 'all', query: '  moon  river ' }, NOW))).toEqual(['Ｍｏｏｎ　Ｒｉｖｅｒ']);
    expect(titles(visibleSongs(LIBRARY, { filter: 'all', query: 'aurora' }, NOW))).toEqual(['Ｍｏｏｎ　Ｒｉｖｅｒ']);
    expect(titles(visibleSongs(LIBRARY, { filter: 'loved', query: '電車' }, NOW))).toEqual(['霧中電車']);
  });

  it('不改動傳入的清單', () => {
    const before = titles(LIBRARY);
    visibleSongs(LIBRARY, { filter: 'all', query: '' }, NOW);
    expect(titles(LIBRARY)).toEqual(before);
  });
});

describe('釘選名額與動作對應', () => {
  it(`已釘 ${PINNED_LIMIT} 首時其他歌顯示已滿；已釘選的歌永遠可以取消`, () => {
    const full = [song('a', { mark: 'pinned' }), song('b', { mark: 'pinned' }), song('c')];
    expect(PINNED_LIMIT).toBe(2);
    expect(pinState(full, full[2]!)).toBe('full');
    expect(pinState(full, full[0]!)).toBe('pinned');
    expect(pinState(full.slice(1), full[2]!)).toBe('available');
  });

  it('動作 → 帳本編輯：收藏＝愛、取消收藏＝還行；釘選／封鎖寫 mark，取消寫 null', () => {
    expect(editFor('love', true)).toEqual({ rating: '愛' });
    expect(editFor('love', false)).toEqual({ rating: '還行' });
    expect(editFor('pin', true)).toEqual({ mark: 'pinned' });
    expect(editFor('pin', false)).toEqual({ mark: null });
    expect(editFor('block', true)).toEqual({ mark: 'blocked' });
    expect(editFor('block', false)).toEqual({ mark: null });
  });

  it('完成訊息說清楚後果', () => {
    expect(doneMessage('pin', true, '遠方的燈')).toBe('已釘選〈遠方的燈〉，之後每輪開台都會帶上。');
    expect(doneMessage('block', true, '遠方的燈')).toContain('不會再排進節目');
    expect(doneMessage('love', false, '遠方的燈')).toContain('評價改為「還行」');
  });
});

describe('評價與帳本紀錄文字', () => {
  const base = { entryId: 'TEST-entry-1', at: daysAgo(1), trackKey: 'a — b', title: 'b', artist: 'a' };

  it('最近評價附短評；沒評過回 null', () => {
    expect(ratingSummary(LIBRARY[0]!)).toBe('愛・「很溫暖」');
    expect(ratingSummary(LIBRARY[1]!)).toBeNull();
  });

  it('每種紀錄都有一句中文說明', () => {
    const entries: LedgerEntry[] = [
      { ...base, kind: 'feedback', showId: 's', rating: '愛', note: '溫暖' },
      { ...base, kind: 'rating', rating: '不對', note: '' },
      { ...base, kind: 'mark', mark: 'pinned' },
      { ...base, kind: 'mark', mark: null },
      { ...base, kind: 'aired', showId: 's' },
    ];
    expect(entries.map(entryLabel)).toEqual(['聽完回饋：愛', '改評價：不對', '釘選', '取消釘選／封鎖', '排進節目']);
    expect(entries.map(entryNote)).toEqual(['溫暖', null, null, null, null]);
  });

  it('空清單訊息依濾鏡與搜尋', () => {
    expect(emptyMessage('loved', '')).toContain('還沒有收藏');
    expect(emptyMessage('recent', '')).toContain(`${RECENT_DAYS} 天`);
    expect(emptyMessage('all', ' 雨 ')).toBe('找不到「雨」。換個曲名或藝人試試。');
  });
});

describe('當種子開台', () => {
  it('只用這一首當歌曲種子，請求符合契約', () => {
    const request = songSeedRequest('遠方的燈', '夜行者', DEFAULT_SETTINGS);
    expect(PlanRequestSchema.parse(request)).toEqual(request);
    expect(request.seed).toEqual({ kind: 'song', text: '遠方的燈', artist: '夜行者' });
    expect(request.requestedCount).toBe(5);
  });
});

function fakeApi(songs: TrackMark[] = LIBRARY): SongsApi & { edits: unknown[] } {
  const edits: unknown[] = [];
  return {
    edits,
    tasteMarks: vi.fn(async () => songs),
    tasteEdit: vi.fn(async (request) => {
      edits.push(request);
      const target = songs.find((item) => 'trackKey' in request.target && item.trackKey === request.target.trackKey)!;
      return { ...target, ...(request.mark !== undefined ? { mark: request.mark } : {}), ...(request.rating ? { rating: request.rating, note: null } : {}) };
    }),
    tasteHistory: vi.fn(async (trackKey: string) => [
      { entryId: 'TEST-entry-1', at: daysAgo(1), trackKey, title: 't', artist: 'a', kind: 'rating', rating: '愛', note: '' } as LedgerEntry,
    ]),
  };
}

async function loaded(api: SongsApi): Promise<MySongsModel> {
  const model = new MySongsModel(api, () => NOW);
  await model.load();
  return model;
}

describe('MySongsModel（接品味帳本 API）', () => {
  it('讀清單並記下讀取時間（最近濾鏡的基準）', async () => {
    const model = await loaded(fakeApi());
    expect(model.getState()).toMatchObject({ status: 'ready', loadedAt: NOW });
    expect(model.getState().songs).toHaveLength(LIBRARY.length);
  });

  it('讀取失敗顯示錯誤；背景重讀失敗保留舊清單、明示過期並可重試', async () => {
    const failing = new MySongsModel({ ...fakeApi(), tasteMarks: async () => { throw localError('NETWORK_ERROR'); } });
    await failing.load();
    expect(failing.getState().status).toBe('error');
    const api = fakeApi();
    const model = await loaded(api);
    api.tasteMarks = async () => { throw localError('NETWORK_ERROR'); };
    await model.load();
    expect(model.getState()).toMatchObject({ status: 'ready', loadError: expect.any(String), loadedAt: NOW });
    expect(model.getState().songs).toHaveLength(LIBRARY.length);
    const html = renderToStaticMarkup(createElement(MySongsPage, { model, onSeed: () => undefined }));
    expect(html).toContain('songs-error');
    expect(html).toContain('上次讀到的清單');
    expect(html).toContain('重新讀取');
    api.tasteMarks = async () => [];
    await model.load();
    expect(model.getState()).toMatchObject({ status: 'ready', loadError: null, songs: [] });
    expect(renderToStaticMarkup(createElement(MySongsPage, { model, onSeed: () => undefined }))).not.toContain('songs-error');
  });

  it('收藏：送 trackKey＋愛，成功後換掉那一列並回完成訊息', async () => {
    const api = fakeApi();
    const model = await loaded(api);
    const target = LIBRARY[4]!;
    const outcome = await model.act(target.trackKey, 'love', true);
    expect(api.edits).toEqual([{ target: { trackKey: target.trackKey }, rating: '愛' }]);
    expect(outcome).toEqual({ ok: true, message: '已收藏〈慢慢醒來〉。' });
    expect(model.getState().songs.find((item) => item.trackKey === target.trackKey)?.rating).toBe('愛');
    expect(model.getState().pending).toBeNull();
  });

  it(`釘選已滿 ${PINNED_LIMIT} 首：不送出，直接回上限提示`, async () => {
    const songs = [song('a', { mark: 'pinned' }), song('b', { mark: 'pinned' }), song('c')];
    const api = fakeApi(songs);
    const model = await loaded(api);
    expect(await model.act(songs[2]!.trackKey, 'pin', true)).toEqual({ ok: false, message: PIN_FULL_MESSAGE });
    expect(api.edits).toEqual([]);
    expect((await model.act(songs[0]!.trackKey, 'pin', false)).ok).toBe(true);
  });

  it('伺服器回 PIN_LIMIT_REACHED（別處先用掉名額）：回伺服器訊息並重讀清單', async () => {
    const api = fakeApi();
    const model = await loaded(api);
    api.tasteEdit = async () => { throw new ApiError({ code: 'PIN_LIMIT_REACHED', message: '釘選已滿 2 首。', retryable: false, requestId: 'r', retryAfterMs: null }, 409); };
    const outcome = await model.act(LIBRARY[0]!.trackKey, 'pin', true);
    expect(outcome).toEqual({ ok: false, message: '釘選已滿 2 首。' });
    expect(api.tasteMarks).toHaveBeenCalledTimes(2);
  });

  it('寫入失敗：清單原樣保留、可再試', async () => {
    const api = fakeApi();
    const model = await loaded(api);
    const successfulEdit = api.tasteEdit;
    api.tasteEdit = async () => { throw localError('NETWORK_ERROR'); };
    const outcome = await model.act(LIBRARY[0]!.trackKey, 'block', true);
    expect(outcome.ok).toBe(false);
    expect(model.getState().songs[0]?.mark).toBeNull();
    expect(model.getState().pending).toBeNull();
    expect(model.getState()).toMatchObject({ actionError: { trackKey: LIBRARY[0]!.trackKey, action: 'block', on: true, message: outcome.message } });
    const html = renderToStaticMarkup(createElement(MySongsPage, { model, onSeed: () => undefined }));
    expect(html).toContain('songs-action-error');
    expect(html).toContain(outcome.message);
    expect(html).toContain('重試封鎖');
    // 重讀成功不代表之前的寫入已成功，錯誤仍須保留。
    await model.load();
    expect(renderToStaticMarkup(createElement(MySongsPage, { model, onSeed: () => undefined }))).toContain('songs-action-error');
    api.tasteEdit = successfulEdit;
    await model.act(LIBRARY[0]!.trackKey, 'block', true);
    expect(model.getState()).toMatchObject({ actionError: null });
    expect(model.getState().songs[0]?.mark).toBe('blocked');
  });

  it('同時只送一個動作', async () => {
    let release: (value: TrackMark) => void = () => undefined;
    const api = fakeApi();
    const model = await loaded(api);
    api.tasteEdit = () => new Promise((resolve) => { release = resolve; });
    const first = model.act(LIBRARY[0]!.trackKey, 'block', true);
    expect((await model.act(LIBRARY[1]!.trackKey, 'block', true)).ok).toBe(false);
    release({ ...LIBRARY[0]!, mark: 'blocked' });
    expect((await first).ok).toBe(true);
  });

  it('背景重讀還在路上時完成動作：較舊的清單不會蓋掉剛更新的那一列', async () => {
    const api = fakeApi();
    const model = await loaded(api);
    let release: (songs: TrackMark[]) => void = () => undefined;
    api.tasteMarks = () => new Promise((resolve) => { release = resolve; });
    const reload = model.load();
    await model.act(LIBRARY[0]!.trackKey, 'block', true);
    release(LIBRARY);
    await reload;
    expect(model.getState().songs[0]?.mark).toBe('blocked');
  });

  it('展開紀錄只讀一次；動過那首之後清掉快取、下次重讀', async () => {
    const api = fakeApi();
    const model = await loaded(api);
    const key = LIBRARY[0]!.trackKey;
    await model.loadHistory(key);
    await model.loadHistory(key);
    expect(api.tasteHistory).toHaveBeenCalledTimes(1);
    expect(model.getState().history[key]).toMatchObject({ status: 'ready', entries: [expect.objectContaining({ kind: 'rating' })] });
    await model.act(key, 'pin', true);
    expect(model.getState().history[key]).toBeUndefined();
  });

  it('紀錄讀取失敗標記錯誤，重試會再讀', async () => {
    const api = fakeApi();
    const model = await loaded(api);
    const key = LIBRARY[0]!.trackKey;
    api.tasteHistory = vi.fn(async () => { throw localError('NETWORK_ERROR'); });
    await model.loadHistory(key);
    expect(model.getState().history[key]?.status).toBe('error');
    await model.loadHistory(key);
    expect(api.tasteHistory).toHaveBeenCalledTimes(2);
  });
});

const NOISE = /MOCK|TEST|假帳本|示範|模式/i;
const noop = () => undefined;

describe('畫面（靜態輸出）', () => {
  it('我的歌：標題、搜尋、四個濾鏡、釘選名額，且沒有模式列／假帳本／測試字樣', async () => {
    const html = renderToStaticMarkup(createElement(MySongsPage, { model: await loaded(fakeApi()), onSeed: noop }));
    expect(html).toContain('>我的歌</h1>');
    expect(html).toContain('搜尋曲名或藝人');
    for (const label of ['全部', '收藏', '封鎖', '最近']) expect(html).toContain(`>${label}</button>`);
    expect(html).toContain('釘選 1／2');
    expect(html).not.toContain('mode-strip');
    expect(html.replace(/<[^>]+>/g, ' ')).not.toMatch(NOISE);
  });

  it('帳本是空的：說明怎麼累積，並給去開台的出口', async () => {
    const html = renderToStaticMarkup(createElement(MySongsPage, { model: await loaded(fakeApi([])), onSeed: noop }));
    expect(html).toContain('還沒有歌');
    expect(html).toContain('去開台');
  });

  const row = (target: TrackMark, pinFull = false) =>
    renderToStaticMarkup(createElement(SongRow, { song: target, pinFull, busy: false, disabled: false, history: undefined, onAction: noop, onSeed: noop, onLoadHistory: noop }));

  it('一般列：收藏／釘選／封鎖是可切換的按鈕，有當種子開台與帳本紀錄展開鈕', () => {
    const html = row(LIBRARY[0]!);
    expect(html).toContain('最近評價：<strong data-song-data="true">愛・「很溫暖」</strong>');
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*?收藏<\/button>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>.*?釘選<\/button>/);
    expect(html).toContain('當種子開台');
    expect(html).toContain('aria-expanded="false"');
  });

  it('釘選已滿時，未釘選的「釘選」鈕指向名額說明', () => {
    expect(row(LIBRARY[0]!, true)).toContain('aria-describedby="pin-status"');
  });

  it.each([null, '還行'] as const)('釘選但評價為 %s 的歌，收藏按鈕未按下', (rating) => {
    expect(row(song('釘選歌', { mark: 'pinned', rating }))).toMatch(/aria-pressed="false"[^>]*>.*?收藏<\/button>/);
  });

  it('封鎖列：只留「封鎖」（可解除）與紀錄，不能收藏、釘選或當種子', () => {
    const html = row(LIBRARY[2]!);
    expect(html).toContain('已封鎖');
    expect(html).not.toContain('>收藏</button>');
    expect(html).not.toContain('當種子開台');
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*?封鎖<\/button>/);
  });
});
