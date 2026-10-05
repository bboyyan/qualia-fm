/**
 * 品味帳本（BRA-134）：本機、機器可讀的 LedgerEntry（只增不改的事件）與 TrackMark（每首歌目前狀態）。
 * 曲目一律以 LLM 當時提名的曲名／藝人識別，永遠不存 Spotify 回傳欄位（Policy III.13／III.14）。
 */
import { z } from 'zod';
import { FeedbackRatingSchema } from './feedback.js';

export const TRACK_TITLE_MAX = 200;
export const TRACK_ARTIST_MAX = 200;
export const TASTE_NOTE_MAX = 200;

/** 曲目比對鍵：NFKC＋小寫＋壓空白；同一首歌大小寫或全半形不同仍視為同一首。 */
export function trackKeyOf(artist: string, title: string): string {
  const norm = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  return `${norm(artist)} — ${norm(title)}`;
}

export const TrackMarkKindSchema = z.enum(['pinned', 'blocked']);
export type TrackMarkKind = z.infer<typeof TrackMarkKindSchema>;

const trackFields = {
  trackKey: z.string().min(1).max(TRACK_TITLE_MAX * 2 + 8),
  title: z.string().min(1).max(TRACK_TITLE_MAX),
  artist: z.string().min(1).max(TRACK_ARTIST_MAX),
};
const entryBase = {
  entryId: z.string().regex(/^[A-Za-z0-9_-]{8,120}$/),
  at: z.iso.datetime(),
  ...trackFields,
};
const note = z.string().max(TASTE_NOTE_MAX);

export const LedgerEntrySchema = z.discriminatedUnion('kind', [
  /** 聽完回饋（BRA-98 流程）：評價＋短評。 */
  z.strictObject({ ...entryBase, kind: z.literal('feedback'), showId: z.string().min(1).max(100), rating: FeedbackRatingSchema, note }),
  /** 手動改評價（不經播放）。 */
  z.strictObject({ ...entryBase, kind: z.literal('rating'), rating: FeedbackRatingSchema, note }),
  /** 手動標記；null＝清除標記。 */
  z.strictObject({ ...entryBase, kind: z.literal('mark'), mark: TrackMarkKindSchema.nullable() }),
  /** 開台時排進節目（近 N 已播的來源）。 */
  z.strictObject({ ...entryBase, kind: z.literal('aired'), showId: z.string().min(1).max(100) }),
]);
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const TrackMarkSchema = z.strictObject({
  ...trackFields,
  mark: TrackMarkKindSchema.nullable(),
  rating: FeedbackRatingSchema.nullable(),
  /** 最近一次評價附的短評；空字串視為沒有。 */
  note: z.string().max(TASTE_NOTE_MAX).nullable(),
  lastAiredAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});
export type TrackMark = z.infer<typeof TrackMarkSchema>;

/** 帳本檔（version 1）：評價／標記依 entries 重算；marks.lastAiredAt 另保留已修剪播出事件的摘要。 */
export const TasteLedgerFileSchema = z.strictObject({
  version: z.literal(1),
  entries: z.array(LedgerEntrySchema),
  marks: z.array(TrackMarkSchema),
});
export type TasteLedgerFile = z.infer<typeof TasteLedgerFileSchema>;

/** 手動改評價／標記：對象是自己節目裡的段落，或帳本裡已有的 trackKey（不接受用戶端自填曲名）。 */
export const TasteEditRequestSchema = z
  .strictObject({
    target: z.union([
      z.strictObject({ showId: z.string().min(1).max(100), segmentId: z.string().min(1).max(100) }),
      z.strictObject({ trackKey: trackFields.trackKey }),
    ]),
    clientRequestId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/).optional(),
    mark: TrackMarkKindSchema.nullable().optional(),
    rating: FeedbackRatingSchema.optional(),
    note: z.string().trim().max(TASTE_NOTE_MAX).optional(),
  })
  .refine((body) => body.mark !== undefined || body.rating !== undefined, { message: 'mark_or_rating_required' })
  .refine((body) => body.note === undefined || body.rating !== undefined, { message: 'note_requires_rating' });
export type TasteEditRequest = z.infer<typeof TasteEditRequestSchema>;

export const TasteMarksResponseSchema = z.strictObject({ marks: z.array(TrackMarkSchema) });
export type TasteMarksResponse = z.infer<typeof TasteMarksResponseSchema>;
