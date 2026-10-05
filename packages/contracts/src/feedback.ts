import { z } from 'zod';

export const CONFIRMED_SEED = { kind: 'song', text: 'Time Flows Ever Onward', artist: 'Evan Call' } as const;
export const FeedbackRatingSchema = z.enum(['愛', '還行', '不對']);
export const FeedbackRequestSchema = z.strictObject({
  showId: z.string().min(1).max(100),
  segmentId: z.string().min(1).max(100),
  clientRequestId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/).optional(),
  rating: FeedbackRatingSchema,
  reason: z.string().trim().max(200),
});
export const LedgerRowSchema = z.strictObject({
  date: z.iso.datetime(),
  seed: z.string().min(1).max(1500),
  recommendation: z.string().min(1).max(500),
  rating: FeedbackRatingSchema,
  reason: z.string().max(200),
});
export const FeedbackReceiptSchema = z.strictObject({ mode: z.enum(['fake', 'notion']), rowId: z.string() });
export type FeedbackRating = z.infer<typeof FeedbackRatingSchema>;
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;
export type LedgerRow = z.infer<typeof LedgerRowSchema>;
export type FeedbackReceipt = z.infer<typeof FeedbackReceiptSchema>;
