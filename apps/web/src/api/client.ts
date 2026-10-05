/**
 * Typed same-origin API client. The CSRF token lives only in this closure's memory —
 * never in localStorage, URLs or logs (handoff AGENTS.md rule 5).
 */
import type { z } from 'zod';
import {
  CapabilitiesSchema,
  FeedbackReceiptSchema,
  type FeedbackRequest,
  type FeedbackReceipt,
  ERROR_MESSAGES,
  ErrorEnvelopeSchema,
  HEADERS,
  JobInfoSchema,
  LovedResultSchema,
  SessionInfoSchema,
  ShowPlanSchema,
  SpotifyDevicesSchema,
  SpotifyPlaybackSchema,
  SpotifyTokenSchema,
  type LovedRequest,
  type LovedResult,
  type SpotifyDevice,
  type SpotifyPlayback,
  type SpotifyPlayRequest,
  type SpotifyToken,
  type Capabilities,
  type ErrorCode,
  type ErrorInfo,
  type JobInfo,
  type MockScenario,
  type PlanRequest,
  type SessionInfo,
  type ShowPlan,
} from '@qualia/contracts';

export class ApiError extends Error {
  constructor(
    readonly info: ErrorInfo,
    readonly status: number,
  ) {
    super(info.message);
    this.name = 'ApiError';
  }

  get code(): ErrorCode {
    return this.info.code;
  }
}

export function localError(code: ErrorCode, message = ERROR_MESSAGES[code]): ApiError {
  return new ApiError({ code, message, retryable: true, requestId: 'client', retryAfterMs: null }, 0);
}

export interface StartPlanOptions {
  idempotencyKey: string;
  scenario?: MockScenario;
  signal?: AbortSignal;
}

export interface ApiClient {
  feedback(request: FeedbackRequest): Promise<FeedbackReceipt>;
  ensureSession(force?: boolean): Promise<SessionInfo>;
  capabilities(signal?: AbortSignal): Promise<Capabilities>;
  startPlan(request: PlanRequest, options: StartPlanOptions): Promise<JobInfo>;
  getJob(jobId: string, signal?: AbortSignal): Promise<JobInfo>;
  cancelJob(jobId: string): Promise<JobInfo>;
  getShow(showId: string, signal?: AbortSignal): Promise<ShowPlan>;
  /** E 模式（伺服器核可且已連結）才可用；token 只給 Web Playback SDK。 */
  spotifyToken(): Promise<SpotifyToken>;
  spotifyDevices(): Promise<SpotifyDevice[]>;
  spotifyPlayback(): Promise<SpotifyPlayback>;
  spotifyPlay(request: SpotifyPlayRequest): Promise<void>;
  spotifyPause(deviceId: string): Promise<void>;
  /** 「愛」確認後加入 Qualia Loved；URI 由伺服器依節目查，用戶端只送段落識別。 */
  spotifyLoved(request: LovedRequest): Promise<LovedResult>;
  spotifyDisconnect(): Promise<void>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function toApiError(res: Response): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => null);
  const parsed = ErrorEnvelopeSchema.safeParse(body);
  if (parsed.success) return new ApiError(parsed.data.error, res.status);
  return new ApiError({ ...localError('INTERNAL').info, requestId: res.headers.get('X-Request-Id') ?? 'unknown' }, res.status);
}

export function createApiClient(fetchImpl: FetchLike = (i, init) => fetch(i, init), baseUrl = ''): ApiClient {
  let session: SessionInfo | null = null;
  let pending: Promise<SessionInfo> | null = null;

  async function request(path: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, { credentials: 'same-origin', ...init });
    } catch (error: unknown) {
      if ((error as Error | null)?.name === 'AbortError') throw error;
      throw localError('NETWORK_ERROR');
    }
    if (!res.ok) throw await toApiError(res);
    return res;
  }

  async function send<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const res = await request(path, init);
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) throw localError('INTERNAL', '服務回應格式不正確，請稍後再試。');
    return parsed.data;
  }

  function mutate<T>(path: string, schema: z.ZodType<T>, method: 'POST' | 'DELETE', extra: Record<string, string> = {}, body?: unknown, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = { [HEADERS.csrf]: session?.csrfToken ?? '', ...extra };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return send(path, schema, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  }

  /** 204 無內容的狀態變更（播放代理、中斷連結）。 */
  async function mutateEmpty(path: string, body?: unknown): Promise<void> {
    await ensureSession();
    const headers: Record<string, string> = { [HEADERS.csrf]: session?.csrfToken ?? '' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    await request(path, { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  async function ensureSession(force = false): Promise<SessionInfo> {
    if (session && !force) return session;
    pending ??= send('/api/session', SessionInfoSchema, { method: 'POST' }).finally(() => {
      pending = null;
    });
    session = await pending;
    return session;
  }

  return {
    feedback: async (request) => {
      await ensureSession();
      return mutate('/api/feedback', FeedbackReceiptSchema, 'POST', {}, request);
    },
    ensureSession,
    capabilities: (signal) => send('/api/capabilities', CapabilitiesSchema, { signal }),
    startPlan: async (request, options) => {
      await ensureSession();
      const extra: Record<string, string> = { [HEADERS.idempotencyKey]: options.idempotencyKey };
      if (options.scenario) extra[HEADERS.mockScenario] = options.scenario;
      return mutate('/api/plan', JobInfoSchema, 'POST', extra, request, options.signal);
    },
    getJob: (jobId, signal) => send(`/api/jobs/${encodeURIComponent(jobId)}`, JobInfoSchema, { signal }),
    cancelJob: (jobId) => mutate(`/api/jobs/${encodeURIComponent(jobId)}`, JobInfoSchema, 'DELETE'),
    getShow: (showId, signal) => send(`/api/shows/${encodeURIComponent(showId)}`, ShowPlanSchema, { signal }),
    spotifyToken: async () => {
      await ensureSession();
      return mutate('/api/spotify/token', SpotifyTokenSchema, 'POST');
    },
    spotifyDevices: async () => (await send('/api/spotify/devices', SpotifyDevicesSchema)).devices,
    spotifyPlayback: () => send('/api/spotify/playback', SpotifyPlaybackSchema),
    spotifyPlay: (play) => mutateEmpty('/api/spotify/play', play),
    spotifyPause: (deviceId) => mutateEmpty('/api/spotify/pause', { deviceId }),
    spotifyLoved: async (loved) => {
      await ensureSession();
      return mutate('/api/spotify/loved', LovedResultSchema, 'POST', {}, loved);
    },
    spotifyDisconnect: () => mutateEmpty('/api/auth/spotify/logout'),
  };
}

export function newIdempotencyKey(): string {
  return `plan_${crypto.randomUUID().replaceAll('-', '')}`;
}
