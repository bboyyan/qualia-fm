/**
 * Runtime schemas for handoff/contracts/domain.ts (schemaVersion 1).
 *
 * Extensions (see docs/implementation/decision-log.md D-03..D-05):
 * - AudioLocator gains `mock_tone`: a client-synthesised test tone, explicitly not music.
 * - Segment gains `speech`: how the DJ intro is rendered (`none` or a `mock_chime`).
 * - ShowPlan gains `unavailable`: candidates that could not be resolved (shown, never playable).
 */
import { z } from 'zod';
import {
  ARTIST_MAX_GRAPHEMES,
  DJ_LINE_MAX_GRAPHEMES,
  SEED_MAX_GRAPHEMES,
  TUNING_MAX_GRAPHEMES,
  countGraphemes,
} from './grapheme.js';

const graphemeRange = (min: number, max: number) => (value: string) => {
  const n = countGraphemes(value);
  return n >= min && n <= max;
};

export const ModeSchema = z.enum(['mock', 'licensed', 'spotify', 'external']);
export type Mode = z.infer<typeof ModeSchema>;

export const EvidenceLevelSchema = z.enum([
  'user_description',
  'licensed_editorial',
  'model_knowledge',
  'unknown',
]);
export type EvidenceLevel = z.infer<typeof EvidenceLevelSchema>;

export const SeedKindSchema = z.enum(['feeling', 'song', 'sound']);
export type SeedKind = z.infer<typeof SeedKindSchema>;

export const SeedSchema = z.strictObject({
  kind: SeedKindSchema,
  text: z
    .string()
    .max(4000)
    .refine((v) => v.trim().length > 0, { message: 'seed_empty' })
    .refine(graphemeRange(1, SEED_MAX_GRAPHEMES), { message: 'seed_too_long' }),
  artist: z
    .string()
    .max(1000)
    .refine(graphemeRange(1, ARTIST_MAX_GRAPHEMES), { message: 'artist_length' })
    .nullable(),
});
export type Seed = z.infer<typeof SeedSchema>;

export const PlanRequestSchema = z.strictObject({
  seed: SeedSchema,
  requestedCount: z.literal(5),
  dj: z.strictObject({ enabled: z.boolean(), length: z.enum(['short', 'standard']) }),
  tuning: z
    .string()
    .max(1000)
    .refine(graphemeRange(1, TUNING_MAX_GRAPHEMES), { message: 'tuning_length' })
    .nullable(),
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

export const SonicDNASchema = z.strictObject({
  hookOfFeeling: z.string().min(1).max(400),
  spatialSignature: z.string().max(400).nullable(),
  emotionalVelocity: z.string().max(400).nullable(),
  timbralPalette: z.array(z.string().max(80)).max(6),
  lyricalContext: z.string().max(400).nullable(),
  basis: EvidenceLevelSchema,
  caveat: z.string().max(400).nullable(),
});
export type SonicDNA = z.infer<typeof SonicDNASchema>;

const djLine = z
  .string()
  .max(400)
  .refine(graphemeRange(1, DJ_LINE_MAX_GRAPHEMES), { message: 'dj_line_length' });

export const TransitionBridgeSchema = z.strictObject({
  fromCandidateId: z.string().min(1).max(64),
  text: z.string().min(1).max(400),
  djLine,
});
export type TransitionBridge = z.infer<typeof TransitionBridgeSchema>;

export const CandidateSchema = z.strictObject({
  candidateId: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  artist: z.string().min(1).max(200),
  versionHint: z.string().max(200).nullable(),
  seedBridge: z.string().min(1).max(400),
  transitionBridge: TransitionBridgeSchema.nullable(),
  vibe: z.tuple([z.string().max(20), z.string().max(20), z.string().max(20)]),
  djLine,
  evidenceLevel: EvidenceLevelSchema,
  evidenceRefs: z.array(z.string().max(200)).max(5),
  uncertainty: z.string().max(400).nullable(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const AudioLocatorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('licensed_url'), url: z.string().min(1).max(2000) }),
  z.strictObject({ kind: z.literal('spotify_uri'), uri: z.string().min(1).max(200) }),
  z.strictObject({
    kind: z.literal('mock_tone'),
    palette: z.number().int().min(0).max(7),
    durationMs: z.number().int().min(1000).max(600_000),
  }),
]);
export type AudioLocator = z.infer<typeof AudioLocatorSchema>;

export const SpeechLocatorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ai_audio'), aiVoice: z.literal(true), url: z.string().regex(/^\/api\/media\/tts\/[A-Za-z0-9_/-]+$/) }),
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({
    kind: z.literal('mock_chime'),
    durationMs: z.number().int().min(300).max(30_000),
  }),
]);
export type SpeechLocator = z.infer<typeof SpeechLocatorSchema>;

/** 真實供應商降級提示的固定開頭；server 只用這些開頭寫入 warnings，前端據此顯示，不猜字串。 */
export const PROVIDER_NOTICES = {
  llm: 'AI 選歌本輪改用 MOCK 示範',
  tts: 'AI 語音本輪改為文字介紹＋提示音',
} as const;
export const isProviderNotice = (warning: string): boolean =>
  Object.values(PROVIDER_NOTICES).some((prefix) => warning.startsWith(prefix));

export const ResolvedTrackSchema = z.strictObject({
  provider: ModeSchema,
  providerTrackId: z.string().max(200).nullable(),
  canonicalTitle: z.string().min(1).max(200),
  canonicalArtists: z.array(z.string().min(1).max(200)).min(1).max(10),
  artworkUrl: z.string().max(2000).nullable(),
  durationMs: z.number().int().positive().nullable(),
  externalUrl: z.string().max(2000).nullable(),
  availability: z.enum(['resolved', 'unavailable', 'unverified']),
  canAttemptPlayback: z.boolean(),
  audioLocator: AudioLocatorSchema,
});
export type ResolvedTrack = z.infer<typeof ResolvedTrackSchema>;

export const SegmentSchema = z.strictObject({
  segmentId: z.string().min(1).max(100),
  candidate: CandidateSchema,
  track: ResolvedTrackSchema,
  speech: SpeechLocatorSchema,
});
export type Segment = z.infer<typeof SegmentSchema>;

export const ShowPlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  showId: z.string().min(1).max(100),
  createdAt: z.iso.datetime(),
  seed: SeedSchema,
  analysis: SonicDNASchema,
  segments: z.array(SegmentSchema).max(5),
  unavailable: z.array(CandidateSchema).max(10),
  warnings: z.array(z.string().max(400)).max(10),
  isDemo: z.boolean(),
});
export type ShowPlan = z.infer<typeof ShowPlanSchema>;

export const PlanDraftSchema = z.strictObject({
  schemaVersion: z.literal(1),
  analysis: SonicDNASchema,
  candidates: z.array(CandidateSchema).min(1).max(7),
  warnings: z.array(z.string().max(400)).max(10),
});
export type PlanDraft = z.infer<typeof PlanDraftSchema>;
