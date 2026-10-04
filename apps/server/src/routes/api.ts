/** /api routes (docs/08 端點). Everything except health, session and gated auth needs a session. */
import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  HEADERS,
  FeedbackRequestSchema,
  MockScenarioSchema,
  PlanRequestSchema,
  type MockScenario,
  type SessionInfo,
} from '@qualia/contracts';
import type { RealProviderRuntime } from '../budget/runtime.js';
import type { OpenAITtsProvider } from '../providers/openai/tts.js';
import type { ServerConfig } from '../config/env.js';
import { AppError } from '../http/errors.js';
import { assertAllowedOrigin, requireCsrf, requireSession, sessionOf } from '../security/guards.js';
import { WindowLimiter } from '../security/rateLimit.js';
import {
  SESSION_COOKIE,
  clearedSessionCookie,
  readCookie,
  sessionCookie,
  type Session,
  type SessionStore,
} from '../security/sessions.js';
import { assertFeatureAllowed, buildCapabilities } from '../services/capabilities.js';
import type { PlanService } from '../services/planService.js';

export interface ApiDeps {
  readonly runtime: RealProviderRuntime;
  readonly tts: OpenAITtsProvider;
  readonly config: ServerConfig;
  readonly sessions: SessionStore;
  readonly plans: PlanService;
  readonly now: () => number;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;

const toSessionInfo = (s: Session): SessionInfo => ({
  sessionId: s.publicId,
  csrfToken: s.csrfToken,
  expiresAt: new Date(s.expiresAt).toISOString(),
});

function scenarioOf(req: Request, config: ServerConfig): MockScenario {
  if (config.mode !== 'mock') return 'five';
  const parsed = MockScenarioSchema.safeParse(req.get(HEADERS.mockScenario));
  return parsed.success ? parsed.data : 'five';
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length > 100) throw new AppError('NOT_FOUND');
  return value;
}

function publicRoutes(router: Router, deps: ApiDeps): void {
  const limiter = new WindowLimiter(deps.config.limits.sessionRateLimitPerMin, 60_000);
  router.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  router.post('/session', (req, res) => {
    assertAllowedOrigin(req, deps.config.allowedOrigins);
    const limit = limiter.hit(req.ip ?? 'unknown', deps.now());
    if (!limit.ok) throw new AppError('RATE_LIMITED', { retryAfterMs: limit.retryAfterMs });
    const existing = deps.sessions.get(readCookie(req.get('cookie'), SESSION_COOKIE), deps.now());
    const session = existing ?? deps.sessions.create(deps.now());
    res.setHeader('Set-Cookie', sessionCookie(session.id, deps.config.secureCookies));
    res.json(toSessionInfo(session));
  });
  // Spotify OAuth/token endpoints exist only as a closed boundary (docs/05, AC27).
  router.use('/auth/spotify', () => assertFeatureAllowed(deps.config, 'spotify_auth'));
}

function planRoutes(router: Router, deps: ApiDeps): void {
  router.post('/feedback', async (req, res) => {
    const parsed = FeedbackRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('INVALID_INPUT');
    res.status(201).json(await deps.plans.feedback(sessionOf(res).id, parsed.data));
  });
  router.post('/plan', (req, res) => {
    const key = req.get(HEADERS.idempotencyKey) ?? '';
    if (!IDEMPOTENCY_KEY.test(key)) throw new AppError('INVALID_INPUT', { message: '缺少有效的 Idempotency-Key。' });
    const parsed = PlanRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('INVALID_INPUT');
    const job = deps.plans.start({
      ownerId: sessionOf(res).id,
      request: parsed.data,
      idempotencyKey: key,
      scenario: scenarioOf(req, deps.config),
    });
    res.status(202).json(job);
  });
  router.get('/jobs/:jobId', (req, res) => {
    res.json(deps.plans.get(sessionOf(res).id, param(req, 'jobId')));
  });
  router.delete('/jobs/:jobId', (req, res) => {
    res.json(deps.plans.cancel(sessionOf(res).id, param(req, 'jobId')));
  });
  router.get('/shows/:showId', (req, res) => {
    res.json(deps.plans.show(sessionOf(res).id, param(req, 'showId')));
  });
}

function sessionRoutes(router: Router, deps: ApiDeps): void {
  router.get('/capabilities', (_req, res) => {
    res.json(buildCapabilities(deps.config, deps.runtime.statusReason()));
  });
  router.post('/tts', async (req, res) => {
    if (deps.config.openai.tts !== 'openai') assertFeatureAllowed(deps.config, 'tts');
    const reason = deps.runtime.reason();
    if (reason) throw new AppError('FEATURE_RESTRICTED', { message: reason });
    const body = z.strictObject({ showId: z.string().min(1).max(100), segmentId: z.string().min(1).max(100), variant: z.literal('seed'), voiceId: z.string().max(100).optional() }).safeParse(req.body);
    if (!body.success) throw new AppError('INVALID_INPUT');
    res.json(await deps.plans.speech(sessionOf(res).id, body.data.showId, body.data.segmentId));
  });
  router.get('/media/tts/:showId/:segmentId/:key', (req, res, next) => {
    const showId = param(req, 'showId');
    const segmentId = param(req, 'segmentId');
    const key = param(req, 'key');
    const segment = deps.plans.show(sessionOf(res).id, showId).segments.find((item) => item.segmentId === segmentId);
    if (!segment || segment.speech.kind !== 'ai_audio' || segment.speech.url !== `/api/media/tts/${showId}/${segmentId}/${key}`) throw new AppError('NOT_FOUND');
    const file = deps.tts.cachedFile(key);
    if (!file) throw new AppError('NOT_FOUND');
    res.setHeader('Cache-Control', 'private, no-store');
    // sendFile 支援 Range／206：iPhone Safari 播放 <audio> 會先送 Range 請求，純 send() 會讓播放失敗。
    res.sendFile(file, { cacheControl: false, lastModified: false, dotfiles: 'deny', headers: { 'Content-Type': 'audio/mpeg' } }, (error) => {
      if (error && !res.headersSent) next(new AppError('NOT_FOUND'));
    });
  });
  router.post('/auth/logout', (_req, res) => {
    const session = sessionOf(res);
    deps.plans.forgetOwner(session.id);
    deps.sessions.delete(session.id);
    res.setHeader('Set-Cookie', clearedSessionCookie(deps.config.secureCookies));
    res.status(204).end();
  });
}

export function createApiRouter(deps: ApiDeps): Router {
  const router = Router();
  publicRoutes(router, deps);
  router.use(requireSession(deps.sessions, deps.now), requireCsrf(deps.config.allowedOrigins));
  sessionRoutes(router, deps);
  planRoutes(router, deps);
  router.use(() => {
    throw new AppError('NOT_FOUND');
  });
  return router;
}
