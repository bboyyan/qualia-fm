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
  SessionInfoSchema,
  ShowPlanSchema,
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

  async function send<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, { credentials: 'same-origin', ...init });
    } catch (error: unknown) {
      if ((error as Error | null)?.name === 'AbortError') throw error;
      throw localError('NETWORK_ERROR');
    }
    if (!res.ok) throw await toApiError(res);
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) throw localError('INTERNAL', '服務回應格式不正確，請稍後再試。');
    return parsed.data;
  }

  function mutate<T>(path: string, schema: z.ZodType<T>, method: 'POST' | 'DELETE', extra: Record<string, string> = {}, body?: unknown, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = { [HEADERS.csrf]: session?.csrfToken ?? '', ...extra };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return send(path, schema, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
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
  };
}

export function newIdempotencyKey(): string {
  return `plan_${crypto.randomUUID().replaceAll('-', '')}`;
}
