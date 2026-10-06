/**
 * 寶石牆（BRA-169）：每趟五首聽完，翻開全部牌後選 1 首成為寶石；每 5 顆解鎖一本「旅程精選集」。
 * 寶石只存 LLM 提名的曲名／藝人、聲景色號與時間；不存種子原文，也不存 Spotify 回傳欄位（D-14）。
 */
import { z } from 'zod';
import { TRACK_ARTIST_MAX, TRACK_TITLE_MAX } from './taste.js';

/** 每本旅程精選集的寶石數。 */
export const GEMS_PER_SELECTION = 5;
/** 寶石色＝聲景場景（SoundscapeArt 8 景）之一。 */
export const GEM_PALETTE_COUNT = 8;

/** 一趟＝播放引擎的一次 loadShow（前端產生的不透明 ID，例如 `ss_lx2k9_3`）。 */
const journeyId = z.string().regex(/^[A-Za-z0-9_-]{4,100}$/);

export const GemSchema = z.strictObject({
  gemId: z.string().regex(/^gem_[A-Za-z0-9_-]{8,100}$/),
  journeyId,
  trackKey: z.string().min(1).max(TRACK_TITLE_MAX * 2 + 8),
  title: z.string().min(1).max(TRACK_TITLE_MAX),
  artist: z.string().min(1).max(TRACK_ARTIST_MAX),
  palette: z.number().int().min(0).max(GEM_PALETTE_COUNT - 1),
  chosenAt: z.iso.datetime(),
});
export type Gem = z.infer<typeof GemSchema>;

/** 寶石牆檔（version 1）：只存寶石本身；精選集由寶石順序推導，不另存。 */
export const GemWallFileSchema = z.strictObject({
  version: z.literal(1),
  gems: z.array(GemSchema),
});
export type GemWallFile = z.infer<typeof GemWallFileSchema>;

export const SelectionSchema = z.strictObject({
  no: z.number().int().min(1),
  gems: z.array(GemSchema).length(GEMS_PER_SELECTION),
});
export type Selection = z.infer<typeof SelectionSchema>;

export const GemWallSchema = z.strictObject({
  /** 收過的寶石總數（含已收進精選集的）。 */
  total: z.number().int().nonnegative(),
  /** 已解鎖的旅程精選集，舊到新。 */
  selections: z.array(SelectionSchema),
  /** 進行中這本的編號與已收寶石（0–4 顆）。 */
  current: z.strictObject({ no: z.number().int().min(1), gems: z.array(GemSchema).max(GEMS_PER_SELECTION - 1) }),
});
export type GemWall = z.infer<typeof GemWallSchema>;

/** 選寶石：對象是自己節目裡的段落（曲名由伺服器查，不接受用戶端自填）。 */
export const ChooseGemRequestSchema = z.strictObject({
  journeyId,
  showId: z.string().min(1).max(100),
  segmentId: z.string().min(1).max(100),
  palette: z.number().int().min(0).max(GEM_PALETTE_COUNT - 1),
});
export type ChooseGemRequest = z.infer<typeof ChooseGemRequestSchema>;

export const ChooseGemResponseSchema = z.strictObject({
  gem: GemSchema,
  wall: GemWallSchema,
  /** 這顆剛好是第 5 顆時，解鎖的那本精選集；否則 null。 */
  unlocked: SelectionSchema.nullable(),
});
export type ChooseGemResponse = z.infer<typeof ChooseGemResponseSchema>;

/** 依收藏順序把寶石切成精選集；不足 5 顆的尾巴是進行中這本。 */
export function gemWallOf(gems: readonly Gem[]): GemWall {
  const complete = Math.floor(gems.length / GEMS_PER_SELECTION);
  const selections = Array.from({ length: complete }, (_, i) => ({
    no: i + 1,
    gems: gems.slice(i * GEMS_PER_SELECTION, (i + 1) * GEMS_PER_SELECTION),
  }));
  return { total: gems.length, selections, current: { no: complete + 1, gems: gems.slice(complete * GEMS_PER_SELECTION) } };
}
