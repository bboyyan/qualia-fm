/**
 * 旅程精選集分享＋繼續旅程（BRA-129）。輸入就是精選集的五首（形狀對齊 BRA-169 的 Gem：曲名／藝人／聲景色號）。
 * 分享紀錄只存這五首與計數；不存種子原文、不存 Spotify 回傳欄位。分享連結只在已登入的 session 內可解析；
 * 公開唯讀端點屬 L2，預設關閉（SHARE_PUBLIC_ENABLED 未設＝404）。
 */
import { z } from 'zod';
import { ARTIST_MAX_GRAPHEMES, SEED_MAX_GRAPHEMES, countGraphemes } from './grapheme.js';
import type { Seed } from './domain.js';
import { TRACK_ARTIST_MAX, TRACK_TITLE_MAX } from './taste.js';

/** 一本旅程精選集的曲數。 */
export const SHARE_TRACK_COUNT = 5;
/** 分享紀錄最多保留這麼多筆（舊的先丟）。 */
export const MAX_SHARE_RECORDS = 200;
/** 內部短碼：9 bytes 隨機 → 12 字元 base64url。 */
export const SHARE_CODE = /^[A-Za-z0-9_-]{12}$/;
/** 連結上的查詢參數：`/?share=<code>`。 */
export const SHARE_QUERY_PARAM = 'share';

export const ShareTrackSchema = z.strictObject({
  trackKey: z.string().min(1).max(TRACK_TITLE_MAX * 2 + 8),
  title: z.string().min(1).max(TRACK_TITLE_MAX),
  artist: z.string().min(1).max(TRACK_ARTIST_MAX),
  palette: z.number().int().min(0).max(7),
});
export type ShareTrack = z.infer<typeof ShareTrackSchema>;

const tracks = z.array(ShareTrackSchema).length(SHARE_TRACK_COUNT);
const selectionNo = z.number().int().min(1).max(10_000);

export const CreateShareRequestSchema = z.strictObject({ selectionNo, tracks });
export type CreateShareRequest = z.infer<typeof CreateShareRequestSchema>;

export const ShareCountsSchema = z.strictObject({
  /** 建立／再次分享的次數。 */
  shared: z.number().int().nonnegative(),
  /** 用連結打開分享頁的次數。 */
  opened: z.number().int().nonnegative(),
  /** 從分享頁「繼續旅程」開出新一台的次數。 */
  continued: z.number().int().nonnegative(),
});
export type ShareCounts = z.infer<typeof ShareCountsSchema>;

export const ShareRecordSchema = z.strictObject({
  code: z.string().regex(SHARE_CODE),
  selectionNo,
  tracks,
  createdAt: z.iso.datetime(),
  counts: ShareCountsSchema,
});
export type ShareRecord = z.infer<typeof ShareRecordSchema>;

/** 本機分享檔（version 1）。 */
export const ShareFileSchema = z.strictObject({
  version: z.literal(1),
  shares: z.array(ShareRecordSchema),
});
export type ShareFile = z.infer<typeof ShareFileSchema>;

export const ShareViewTrackSchema = ShareTrackSchema.extend({ spotifyUrl: z.url().max(2000) });
export type ShareViewTrack = z.infer<typeof ShareViewTrackSchema>;

/** 分享頁的唯讀內容（session 內）。 */
export const ShareViewSchema = z.strictObject({
  code: z.string().regex(SHARE_CODE),
  selectionNo,
  createdAt: z.iso.datetime(),
  tracks: z.array(ShareViewTrackSchema).length(SHARE_TRACK_COUNT),
  counts: ShareCountsSchema,
  /** 公開連結（L2）是否開放；本版永遠 false。 */
  publicLinkEnabled: z.boolean(),
});
export type ShareView = z.infer<typeof ShareViewSchema>;

export const ShareEventKindSchema = z.enum(['opened', 'continued']);
export type ShareEventKind = z.infer<typeof ShareEventKindSchema>;
export const ShareEventRequestSchema = z.strictObject({ kind: ShareEventKindSchema });
export type ShareEventRequest = z.infer<typeof ShareEventRequestSchema>;

/** Spotify 單曲連結：由曲名＋藝人推導的搜尋網址（不保存 Spotify 回傳的 ID）。 */
export function spotifySearchUrl(title: string, artist: string): string {
  return `https://open.spotify.com/search/${encodeURIComponent(`${title} ${artist}`)}`;
}

const SEPARATOR = '／';

function joined(values: readonly string[]): string {
  return values.join(SEPARATOR);
}

function uniqueArtists(list: readonly ShareTrack[]): string {
  return joined([...new Set(list.map((track) => track.artist))]);
}

/**
 * 「繼續旅程」的種子：精選集曲名串成一個歌曲種子（與開台頁多選種子同一格式）。
 * 超過字數上限時依序保留放得下的曲目，至少一首。
 */
export function continuationSeed(list: readonly ShareTrack[]): Seed {
  const fits = (picked: readonly ShareTrack[]): boolean =>
    countGraphemes(joined(picked.map((track) => track.title))) <= SEED_MAX_GRAPHEMES &&
    countGraphemes(uniqueArtists(picked)) <= ARTIST_MAX_GRAPHEMES;
  let picked = list.slice(0, 1);
  for (const track of list.slice(1)) {
    const next = [...picked, track];
    if (!fits(next)) break;
    picked = next;
  }
  return { kind: 'song', text: joined(picked.map((track) => track.title)), artist: uniqueArtists(picked) };
}
