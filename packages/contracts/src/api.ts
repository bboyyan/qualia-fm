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
  /** 只在 SPOTIFY_ENABLED=true 時出現；連結狀態由伺服器的 token 檔決定。 */
  spotify: z.strictObject({
    linked: z.boolean(),
    clientId: z.string().max(100),
    redirectUri: z.string().max(500),
    lovedPlaylistId: z.string().regex(/^[A-Za-z0-9]{22}$/),
    scopes: z.array(z.string().max(60)).max(10),
  }).optional(),
  restrictions: z.array(z.string().max(300)).max(12),
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

/**
 * Spotify 最小權限（REQUIREMENTS B2）。user-read-email／user-read-private 是 Web Playback SDK 官方要求的
 * 必要 scope；本站不呼叫任何讀取個人資料（/me 等）的 API。不含收藏、播放紀錄、top 等擴大資料面的 scope。
 */
export const SPOTIFY_SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-modify-private',
  'playlist-read-private',
] as const;

export const SPOTIFY_TRACK_URI = /^spotify:track:[A-Za-z0-9]{22}$/;
export const SPOTIFY_DEVICE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export const SpotifyTokenSchema = z.strictObject({ accessToken: z.string().min(1).max(2000), expiresAt: z.iso.datetime() });
export type SpotifyToken = z.infer<typeof SpotifyTokenSchema>;

export const SpotifyDeviceSchema = z.strictObject({
  id: z.string().regex(SPOTIFY_DEVICE_ID),
  name: z.string().max(200),
  type: z.string().max(40),
  isActive: z.boolean(),
});
export type SpotifyDevice = z.infer<typeof SpotifyDeviceSchema>;
export const SpotifyDevicesSchema = z.strictObject({ devices: z.array(SpotifyDeviceSchema).max(50) });

export const SpotifyPlaybackSchema = z.strictObject({
  deviceId: z.string().nullable(),
  isPlaying: z.boolean(),
  uri: z.string().nullable(),
  progressMs: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().nullable(),
});
export type SpotifyPlayback = z.infer<typeof SpotifyPlaybackSchema>;

export const SpotifyPlayRequestSchema = z.strictObject({
  deviceId: z.string().regex(SPOTIFY_DEVICE_ID),
  uri: z.string().regex(SPOTIFY_TRACK_URI),
  positionMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
});
export type SpotifyPlayRequest = z.infer<typeof SpotifyPlayRequestSchema>;
export const SpotifyPauseRequestSchema = z.strictObject({ deviceId: z.string().regex(SPOTIFY_DEVICE_ID) });

export const LovedRequestSchema = z.strictObject({ showId: z.string().min(1).max(100), segmentId: z.string().min(1).max(100) });
export type LovedRequest = z.infer<typeof LovedRequestSchema>;
export const LovedResultSchema = z.strictObject({ status: z.enum(['added', 'already']), playlistId: z.string().regex(/^[A-Za-z0-9]{22}$/) });
export type LovedResult = z.infer<typeof LovedResultSchema>;

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
