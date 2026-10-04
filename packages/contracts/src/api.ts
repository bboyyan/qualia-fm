import { z } from 'zod';
import { ErrorInfoSchema } from './errors.js';
import { ModeSchema } from './domain.js';

export const HealthSchema = z.strictObject({ ok: z.literal(true) });
export type Health = z.infer<typeof HealthSchema>;

export const SessionInfoSchema = z.strictObject({
  sessionId: z.string().min(1),
  csrfToken: z.string().min(16),
  expiresAt: z.iso.datetime(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

export const CapabilitiesSchema = z.strictObject({
  mode: ModeSchema,
  spotifyEnabled: z.boolean(),
  spotifyDjApproved: z.boolean(),
  canPlay: z.boolean(),
  canSeek: z.boolean(),
  canProgrammaticallySetVolume: z.boolean(),
  canInsertSpeech: z.boolean(),
  canOverlap: z.literal(false),
  supportsBackground: z.enum(['unknown', 'tested-limited', 'unsupported']),
  providers: z.strictObject({ llm: z.enum(['mock', 'openai']), tts: z.enum(['mock', 'openai']), reason: z.string().max(300).nullable() }).optional(),
  restrictions: z.array(z.string().max(300)).max(12),
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

export const JOB_PHASES = ['queued', 'understanding', 'matching', 'resolving', 'preparing', 'done'] as const;
export const JobPhaseSchema = z.enum(JOB_PHASES);
export type JobPhase = z.infer<typeof JobPhaseSchema>;

export const JobStatusSchema = z.enum(['queued', 'running', 'completed', 'partial', 'failed', 'cancelled']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobInfoSchema = z.strictObject({
  jobId: z.string().min(1),
  generationId: z.string().min(1),
  status: JobStatusSchema,
  phase: JobPhaseSchema,
  showId: z.string().nullable(),
  error: ErrorInfoSchema.nullable(),
});
export type JobInfo = z.infer<typeof JobInfoSchema>;

export const TERMINAL_JOB_STATUSES: ReadonlySet<JobStatus> = new Set([
  'completed',
  'partial',
  'failed',
  'cancelled',
]);

/** Header names shared by client and server. */
export const HEADERS = {
  csrf: 'X-CSRF-Token',
  idempotencyKey: 'Idempotency-Key',
  /** Honoured only when the server runs every provider in mock mode. */
  mockScenario: 'X-Mock-Scenario',
} as const;

export const MOCK_SCENARIOS = ['five', 'three', 'zero', 'error', 'slow'] as const;
export const MockScenarioSchema = z.enum(MOCK_SCENARIOS);
export type MockScenario = z.infer<typeof MockScenarioSchema>;
