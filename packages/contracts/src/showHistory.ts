import { z } from 'zod';
import { SeedSchema } from './domain.js';

/** 本機單人開台履歷，只保存原始提名，不保存播放來源或語音 URL。 */
export const ShowSummarySchema = z.strictObject({
  showId: z.string().min(1).max(100),
  createdAt: z.iso.datetime(),
  seed: SeedSchema,
  trackCount: z.number().int().min(0).max(5),
  tracks: z.array(z.strictObject({ title: z.string().max(400), artist: z.string().max(400) })).max(5),
  ttsDegraded: z.boolean(),
  speech: z.enum(['off', 'mock_chime', 'ai_audio', 'text']),
});
export type ShowSummary = z.infer<typeof ShowSummarySchema>;
export const ShowHistoryResponseSchema = z.strictObject({ shows: z.array(ShowSummarySchema) });
export const ShowHistoryFileSchema = z.strictObject({ version: z.literal(1), shows: z.array(ShowSummarySchema) });
