/**
 * BRA-117 A：預設「歌曲」種子、種子清單多選＋全選快速開台；Ready 的 5 首用同一套勾選清單。
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlanRequestSchema, trackKeyOf, type TrackMark } from '@qualia/contracts';
import { DEFAULT_SETTINGS } from '../src/features/settings/settings';
import { isAllSelected, pickSegments, pickSelected, startLabel, toggleAll, toggleId } from '../src/features/seed/selection';
import {
  DEFAULT_DRAFT,
  DEFAULT_SEED,
  DEFAULT_SEED_SPOTIFY_URI,
  addSongSeed,
  combineSeeds,
  mergeLedgerSeeds,
  toggleSongSeed,
  draftProblem,
  removeSongSeed,
  songStartLabel,
  toPlanRequest,
  withPendingSong,
} from '../src/features/seed/seedList';
import { SelectableList } from '../src/features/seed/SelectableList';
import { ReadyView } from '../src/features/seed/ReadyView';
import { SeedComposer } from '../src/features/seed/SeedComposer';
import { makeShow } from './fixtures';

const noop = () => undefined;

describe('selection（種子清單與 Ready 共用）', () => {
  it('toggleId 加入／移除，保持不可變', () => {
    const selected = ['a'];
    expect(toggleId(selected, 'b')).toEqual(['a', 'b']);
    expect(toggleId(selected, 'a')).toEqual([]);
    expect(selected).toEqual(['a']);
  });

  it('toggleAll：沒全選 → 全選；已全選 → 全部取消', () => {
    expect(toggleAll(['a', 'b'], ['a'])).toEqual(['a', 'b']);
    expect(toggleAll(['a', 'b'], ['b', 'a'])).toEqual([]);
    expect(isAllSelected(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(isAllSelected([], [])).toBe(false);
  });

  it('pickSelected 依清單順序回傳', () => {
    expect(pickSelected([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['c', 'a'], (x) => x.id)).toEqual([{ id: 'a' }, { id: 'c' }]);
  });

  it('startLabel：全選時一鍵「全選・…」，部分選取時說明數量', () => {
    expect(startLabel('快速開台', 1, 1)).toBe('全選・快速開台');
    expect(startLabel('開始收聽', 5, 5)).toBe('全選・開始收聽');
    expect(startLabel('開始收聽', 3, 5)).toBe('開始收聽（已選 3／5）');
  });
});

describe('pickSegments：Ready 只播勾選的曲目', () => {
  it('依節目順序保留勾選的段落，其餘欄位不變', () => {
    const show = makeShow();
    const picked = pickSegments(show, ['showA_4', 'showA_2']);
    expect(picked.segments.map((s) => s.segmentId)).toEqual(['showA_2', 'showA_4']);
    expect(picked.showId).toBe(show.showId);
    expect(show.segments).toHaveLength(5);
  });

  it('全選時原樣回傳', () => {
    const show = makeShow();
    expect(pickSegments(show, show.segments.map((s) => s.segmentId))).toBe(show);
  });
});

describe('預設種子', () => {
  it('開台預設是歌曲模式，預設種子是 Evan Call〈Time Flows Ever Onward〉並已勾選', () => {
    expect(DEFAULT_DRAFT.kind).toBe('song');
    expect(DEFAULT_SEED).toMatchObject({ title: 'Time Flows Ever Onward', artist: 'Evan Call', isDefault: true });
    expect(DEFAULT_SEED.note).toContain('葬送的芙莉蓮');
    expect(DEFAULT_DRAFT.seeds).toEqual([DEFAULT_SEED]);
    expect(DEFAULT_DRAFT.selectedSeedIds).toEqual([DEFAULT_SEED.id]);
  });

  it('固定 Frieren OST 版的 Spotify 曲目 ID（只供對照，不進選歌請求）', () => {
    expect(DEFAULT_SEED_SPOTIFY_URI).toBe('spotify:track:5filwtvsV0xyRFqja0Whtr');
    const request = toPlanRequest(DEFAULT_DRAFT, DEFAULT_SETTINGS);
    expect(JSON.stringify(request)).not.toContain('5filwtvsV0xyRFqja0Whtr');
    expect(JSON.stringify(request)).not.toContain('spotify');
  });
});

describe('種子清單', () => {
  it('加入一首：新增並勾選；同名同藝人不重複', () => {
    const first = addSongSeed(DEFAULT_DRAFT, '  TEST 第二首 ', ' TEST 藝人 ');
    expect(first.seeds).toHaveLength(2);
    expect(first.seeds[1]).toMatchObject({ title: 'TEST 第二首', artist: 'TEST 藝人', isDefault: false });
    expect(first.selectedSeedIds).toEqual([DEFAULT_SEED.id, first.seeds[1]!.id]);
    const again = addSongSeed(first, 'test 第二首', 'test 藝人');
    expect(again.seeds).toHaveLength(2);
  });

  it('預設種子不能刪，只能取消勾選（可更換）', () => {
    expect(removeSongSeed(DEFAULT_DRAFT, DEFAULT_SEED.id)).toBe(DEFAULT_DRAFT);
    const added = addSongSeed(DEFAULT_DRAFT, 'TEST 第二首', '');
    const removed = removeSongSeed(added, added.seeds[1]!.id);
    expect(removed.seeds).toEqual([DEFAULT_SEED]);
    expect(removed.selectedSeedIds).toEqual([DEFAULT_SEED.id]);
  });

  it('多選合併成一個歌曲種子：曲名與藝人用「／」串起來', () => {
    const added = addSongSeed(DEFAULT_DRAFT, 'TEST 第二首', 'TEST 藝人');
    expect(combineSeeds(added.seeds)).toEqual({ text: 'Time Flows Ever Onward／TEST 第二首', artist: 'Evan Call／TEST 藝人' });
    expect(combineSeeds([{ ...DEFAULT_SEED, artist: null }])).toEqual({ text: 'Time Flows Ever Onward', artist: null });
  });

  it('toPlanRequest（歌曲模式）只用勾選的種子，並符合契約', () => {
    const added = addSongSeed(DEFAULT_DRAFT, 'TEST 第二首', '');
    const onlySecond = { ...added, selectedSeedIds: [added.seeds[1]!.id] };
    const request = toPlanRequest(onlySecond, DEFAULT_SETTINGS);
    expect(request.seed).toEqual({ kind: 'song', text: 'TEST 第二首', artist: null });
    expect(PlanRequestSchema.safeParse(request).success).toBe(true);
    expect(PlanRequestSchema.safeParse(toPlanRequest(DEFAULT_DRAFT, DEFAULT_SETTINGS)).success).toBe(true);
  });

  it('toPlanRequest（感覺模式）照舊用輸入文字', () => {
    const request = toPlanRequest({ ...DEFAULT_DRAFT, kind: 'feeling', text: ' TEST 深夜 ' }, DEFAULT_SETTINGS);
    expect(request.seed).toEqual({ kind: 'feeling', text: 'TEST 深夜', artist: null });
  });

  it('送出時輸入框裡還有歌名：先加入清單並勾選，再開台', () => {
    const pending = withPendingSong({ ...DEFAULT_DRAFT, text: 'TEST 打了沒加', artist: 'TEST 藝人' });
    expect(pending.text).toBe('');
    expect(pending.artist).toBe('');
    expect(pending.seeds.map((s) => s.title)).toEqual(['Time Flows Ever Onward', 'TEST 打了沒加']);
    expect(pending.selectedSeedIds).toHaveLength(2);
    expect(withPendingSong(DEFAULT_DRAFT)).toBe(DEFAULT_DRAFT);
  });

  it('沒勾任何種子時說明下一步；感覺模式照舊檢查空白', () => {
    expect(draftProblem({ ...DEFAULT_DRAFT, selectedSeedIds: [] })).toContain('至少勾選');
    expect(draftProblem({ ...DEFAULT_DRAFT, selectedSeedIds: [], text: 'TEST 待加入' })).toBeNull();
    expect(draftProblem(DEFAULT_DRAFT)).toBeNull();
    expect(draftProblem({ ...DEFAULT_DRAFT, kind: 'feeling', text: '' })).not.toBeNull();
  });
});

describe('SelectableList（同一個元件，兩處共用）', () => {
  const items = [{ id: 'a', title: 'TEST 甲' }, { id: 'b', title: 'TEST 乙', meta: 'TEST 藝人' }];

  it('有「全選」切換與已選數量；每列是可勾選的核取方塊', () => {
    const html = renderToStaticMarkup(createElement(SelectableList, { label: 'TEST 清單', items, selected: ['a'], onToggle: noop, onToggleAll: noop, testId: 'list' }));
    expect(html).toContain('已選 1／2');
    expect(html).toContain('>全選<');
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
  });

  it('已全選時按鈕改為「取消全選」', () => {
    const html = renderToStaticMarkup(createElement(SelectableList, { label: 'x', items, selected: ['a', 'b'], onToggle: noop, onToggleAll: noop }));
    expect(html).toContain('取消全選');
  });
});

describe('ReadyView：5 首預設全選，一鍵開始', () => {
  const render = (props: Partial<Parameters<typeof ReadyView>[0]> = {}) => renderToStaticMarkup(createElement(ReadyView, {
    show: makeShow(), hasActiveShow: false, onStart: noop, onBackToListen: noop, onEdit: noop, onRegenerate: noop, ...props,
  }));

  it('列出 5 首、全部勾選，主按鈕是「全選・開始收聽」', () => {
    const html = render();
    for (let n = 1; n <= 5; n += 1) expect(html).toContain(`曲目${n}`);
    expect(html.match(/checked=""/g)).toHaveLength(5);
    expect(html).toContain('全選・開始收聽');
  });

  it('切換節目時文字仍是「現在切換至新節目」', () => {
    expect(render({ hasActiveShow: true })).toContain('全選・現在切換至新節目');
  });
});

describe('SeedComposer：開台預設歌曲模式＋預設種子卡', () => {
  const render = (continuing = false) => renderToStaticMarkup(createElement(SeedComposer, { continuing, onSubmit: noop }));

  it('預設種子卡標「預設種子・可更換」，已勾選，主按鈕一鍵「全選・快速開台」', () => {
    const html = render();
    expect(html).toContain('預設種子・可更換');
    expect(html).toContain('Time Flows Ever Onward');
    expect(html).toContain('Evan Call');
    expect(html).toContain('葬送的芙莉蓮');
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
    expect(html).toContain('全選・快速開台');
    expect(html).toMatch(/role="radio"[^>]*aria-checked="true"[^>]*>[\s\S]*?歌曲/);
  });

  it('預設種子沒有「移除」，只能取消勾選更換', () => {
    expect(render()).not.toContain('從清單移除');
  });

  it('已有節目在播：主按鈕是「全選・建立下一段」', () => {
    expect(render(true)).toContain('全選・建立下一段');
  });
});

const ledgerSong = (title: string, patch: Partial<TrackMark> = {}): TrackMark => ({
  title, artist: 'Artist', trackKey: trackKeyOf('Artist', title), mark: null, rating: null,
  note: null, lastAiredAt: null, updatedAt: '2026-10-06T00:00:00Z', ...patch,
});

describe('BRA-156：帳本種子', () => {
  it('釘選與愛列入候選但不自動勾選，可選取並用文字開台；封鎖與最近播過不列入', () => {
    const draft = mergeLedgerSeeds(DEFAULT_DRAFT, [
      ledgerSong('Pinned', { mark: 'pinned' }), ledgerSong('Loved', { rating: '愛' }),
      ledgerSong('Blocked', { mark: 'blocked', rating: '愛' }),
      ledgerSong('Recent', { lastAiredAt: '2026-10-06T00:00:00Z' }),
    ]);
    expect(draft.seeds.map((seed) => seed.title)).toEqual(['Time Flows Ever Onward', 'Pinned', 'Loved']);
    expect(draft.selectedSeedIds).toEqual([DEFAULT_SEED.id]);
    const picked = toggleSongSeed({ ...draft, selectedSeedIds: [] }, draft.seeds[1]!.id);
    expect(toPlanRequest(picked, DEFAULT_SETTINGS).seed).toEqual({ kind: 'song', text: 'Pinned', artist: 'Artist' });
  });
});

it('BRA-156：同曲合併 NFKC／大小寫／空白，帳本來源不能移除；解除後只保留預設與手動來源', () => {
  const manual = addSongSeed(DEFAULT_DRAFT, 'Song', 'Artist');
  const draft = mergeLedgerSeeds(manual, [
    ledgerSong('Ｔｉｍｅ Flows Ever Onward', { artist: ' EVAN  CALL ', rating: '愛' }),
    ledgerSong('ＳＯＮＧ', { rating: '愛' }), ledgerSong('Only ledger', { mark: 'pinned' }),
  ]);
  expect(draft.seeds.map((seed) => seed.title)).toEqual(['Time Flows Ever Onward', 'Song', 'Only ledger']);
  expect(addSongSeed(draft, ' ＳＯＮＧ ', ' ARTIST ').seeds).toHaveLength(3);
  expect(removeSongSeed(draft, draft.seeds[1]!.id)).toBe(draft);
  expect(removeSongSeed(draft, draft.seeds[2]!.id)).toBe(draft);
  const unchecked = toggleSongSeed(draft, manual.seeds[1]!.id);
  expect(mergeLedgerSeeds(unchecked, [ledgerSong('Song', { rating: '愛' })]).selectedSeedIds).toEqual([DEFAULT_SEED.id]);
  const cleared = mergeLedgerSeeds(draft, []);
  expect(cleared.seeds.map((seed) => seed.title)).toEqual(['Time Flows Ever Onward', 'Song']);
  expect(removeSongSeed(cleared, cleared.seeds[1]!.id).seeds).toEqual([expect.objectContaining({ isDefault: true })]);
});

it('BRA-156：封鎖優先於預設／手動種子，失效選取一併移除', () => {
  const draft = addSongSeed(DEFAULT_DRAFT, 'Manual', 'Artist');
  const merged = mergeLedgerSeeds(draft, [
    ledgerSong('Time Flows Ever Onward', { artist: 'Evan Call', mark: 'blocked', rating: '愛' }),
    ledgerSong('Manual', { mark: 'blocked', rating: '愛' }),
  ]);
  expect(merged.seeds).toEqual([]);
  expect(merged.selectedSeedIds).toEqual([]);
  expect(draftProblem(merged)).toContain('至少勾選');
});

it('BRA-156：釘選兼收藏只列一次，解除其中之一仍保留；兩者皆解除才刪掉純帳本來源', () => {
  const both = mergeLedgerSeeds(DEFAULT_DRAFT, [ledgerSong('Both', { mark: 'pinned', rating: '愛' })]);
  expect(both.seeds.map((seed) => seed.title)).toEqual(['Time Flows Ever Onward', 'Both']);
  const selected = toggleSongSeed(both, both.seeds[1]!.id);
  for (const patch of [{ rating: '愛' as const }, { mark: 'pinned' as const, rating: '還行' as const }]) {
    const one = mergeLedgerSeeds(selected, [ledgerSong('Both', patch)]);
    expect(one.seeds).toHaveLength(2);
    expect(one.selectedSeedIds).toEqual(selected.selectedSeedIds);
  }
  const cleared = mergeLedgerSeeds(selected, [ledgerSong('Both', { rating: '還行' })]);
  expect(cleared.seeds.map((seed) => seed.title)).toEqual(['Time Flows Ever Onward']);
  expect(cleared.selectedSeedIds).toEqual([DEFAULT_SEED.id]);
});

it('BRA-156：同步後手動輸入已封鎖同曲也不能重新放進選單，保留輸入並提示解除封鎖', () => {
  const draft = mergeLedgerSeeds(DEFAULT_DRAFT, [ledgerSong('Blocked', { mark: 'blocked' })]);
  expect(addSongSeed(draft, 'ＢＬＯＣＫＥＤ', ' artist ')).toBe(draft);
  const pending = { ...draft, text: 'Blocked', artist: 'Artist' };
  expect(withPendingSong(pending)).toBe(pending);
  expect(draftProblem(pending)).toContain('已封鎖');
  const unblocked = mergeLedgerSeeds(draft, [ledgerSong('Blocked')]);
  expect(addSongSeed(unblocked, 'Blocked', 'Artist').seeds.map((seed) => seed.title)).toEqual(['Time Flows Ever Onward', 'Blocked']);
});

it('D-41：開台鈕依可見項目顯示全選／部分；收合帳本不計 X、N，全選後恢復', () => {
  const base = addSongSeed(DEFAULT_DRAFT, 'Manual', 'Artist');
  const draft = mergeLedgerSeeds(base, [ledgerSong('Loved', { rating: '愛' })]);
  expect(songStartLabel('快速開台', draft, false)).toBe('全選・快速開台');
  expect(songStartLabel('快速開台', draft, true)).toBe('快速開台（已選 2／3）');
  const partial = toggleSongSeed(draft, DEFAULT_SEED.id);
  expect(songStartLabel('快速開台', partial, false)).toBe('快速開台（已選 1／2）');
  expect(songStartLabel('快速開台', partial, true)).toBe('快速開台（已選 1／3）');
  const all = { ...partial, selectedSeedIds: toggleAll(partial.seeds.map((seed) => seed.id), partial.selectedSeedIds) };
  expect(songStartLabel('快速開台', all, true)).toBe('全選・快速開台');
  const hiddenSelected = toggleSongSeed(all, DEFAULT_SEED.id);
  expect(songStartLabel('快速開台', hiddenSelected, false)).toBe('快速開台（已選 1／2）');
  expect(songStartLabel('快速開台', hiddenSelected, true)).toBe('快速開台（已選 2／3）');
  expect(draft.selectedSeedIds).toEqual(base.selectedSeedIds);
});
