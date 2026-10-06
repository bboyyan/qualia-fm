/** 按需展示資料：不屬於品味帳本，也不得送入 AI。 */
import { z } from 'zod';
import { ResolvedTrackSchema } from './domain.js';
import { TrackMarkSchema } from './taste.js';

export const SONG_DISPLAY_LIMIT = 10;
export const SongDisplayRequestSchema = z.strictObject({
  trackKeys: z.array(TrackMarkSchema.shape.trackKey).min(1).max(SONG_DISPLAY_LIMIT)
    .refine((keys) => new Set(keys).size === keys.length, 'duplicate_track_key'),
});
export const SongDisplayMetadataSchema = ResolvedTrackSchema.pick({
  canonicalTitle: true, canonicalArtists: true, canonicalAlbum: true, artworkUrl: true, externalUrl: true,
});
export const SongDisplaySchema = z.discriminatedUnion('status', [
  z.strictObject({ trackKey: TrackMarkSchema.shape.trackKey, status: z.literal('available'), metadata: SongDisplayMetadataSchema }),
  z.strictObject({ trackKey: TrackMarkSchema.shape.trackKey, status: z.literal('unavailable') }),
]);
export const SongDisplayResponseSchema = z.strictObject({ items: z.array(SongDisplaySchema).max(SONG_DISPLAY_LIMIT) });
export type SongDisplay = z.infer<typeof SongDisplaySchema>;
export type SongDisplayMetadata = z.infer<typeof SongDisplayMetadataSchema>;
