import { expect, it } from 'vitest';
import {
  CreateShareRequestSchema,
  SEED_MAX_GRAPHEMES,
  SHARE_CODE,
  ShareEventRequestSchema,
  ShareFileSchema,
  continuationSeed,
  countGraphemes,
  spotifySearchUrl,
  trackKeyOf,
  type ShareTrack,
} from '../src/index.js';

const track = (n: number, artist = `TEST Artist ${n}`): ShareTrack => ({
  trackKey: trackKeyOf(artist, `TEST Song ${n}`),
  title: `TEST Song ${n}`,
  artist,
  palette: n % 8,
});
const five = [1, 2, 3, 4, 5].map((n) => track(n));

it('建立分享只收精選集的剛好五首，拒絕多餘欄位（例如種子原文、Spotify URI）', () => {
  expect(CreateShareRequestSchema.safeParse({ selectionNo: 2, tracks: five }).success).toBe(true);
  expect(CreateShareRequestSchema.safeParse({ selectionNo: 2, tracks: five.slice(0, 4) }).success).toBe(false);
  expect(CreateShareRequestSchema.safeParse({ selectionNo: 0, tracks: five }).success).toBe(false);
  expect(CreateShareRequestSchema.safeParse({ selectionNo: 2, tracks: five, seed: 'TEST 私事' }).success).toBe(false);
  expect(CreateShareRequestSchema.safeParse({ selectionNo: 2, tracks: [{ ...five[0], uri: 'spotify:track:TEST' }, ...five.slice(1)] }).success).toBe(false);
});

it('分享短碼是 12 字元 URL 安全字串', () => {
  expect(SHARE_CODE.test('Ab3_-Zx9Qw2k')).toBe(true);
  expect(SHARE_CODE.test('short')).toBe(false);
  expect(SHARE_CODE.test('../etc/passwd')).toBe(false);
});

it('事件只接受開啟與繼續旅程兩種', () => {
  expect(ShareEventRequestSchema.safeParse({ kind: 'opened' }).success).toBe(true);
  expect(ShareEventRequestSchema.safeParse({ kind: 'continued' }).success).toBe(true);
  expect(ShareEventRequestSchema.safeParse({ kind: 'shared' }).success).toBe(false);
});

it('分享檔不接受種子欄位', () => {
  const record = { code: 'Ab3_-Zx9Qw2k', selectionNo: 1, tracks: five, createdAt: '2026-10-06T00:00:00.000Z', counts: { shared: 1, opened: 0, continued: 0 } };
  expect(ShareFileSchema.safeParse({ version: 1, shares: [record] }).success).toBe(true);
  expect(ShareFileSchema.safeParse({ version: 1, shares: [{ ...record, seed: 'TEST' }] }).success).toBe(false);
});

it('Spotify 連結是由曲名＋藝人推導的 open.spotify.com 搜尋網址（不存 Spotify 回傳欄位）', () => {
  expect(spotifySearchUrl('晚安 練習曲', 'Mono/Lune')).toBe('https://open.spotify.com/search/%E6%99%9A%E5%AE%89%20%E7%B7%B4%E7%BF%92%E6%9B%B2%20Mono%2FLune');
});

it('繼續旅程的種子：五首曲名以「／」串成歌曲種子，藝人去重', () => {
  const seed = continuationSeed([track(1, 'A'), track(2, 'A'), track(3, 'B'), track(4, 'C'), track(5, 'C')]);
  expect(seed).toEqual({ kind: 'song', text: 'TEST Song 1／TEST Song 2／TEST Song 3／TEST Song 4／TEST Song 5', artist: 'A／B／C' });
});

it('繼續旅程的種子超過字數上限時，依序保留放得下的曲目（至少一首）', () => {
  const long = (n: number): ShareTrack => ({ ...track(n), title: `${'長'.repeat(180)}${n}` });
  const seed = continuationSeed([1, 2, 3, 4, 5].map(long));
  expect(countGraphemes(seed.text)).toBeLessThanOrEqual(SEED_MAX_GRAPHEMES);
  expect(seed.text.split('／')).toHaveLength(2);
  expect(seed.artist).toBe('TEST Artist 1／TEST Artist 2');
});
