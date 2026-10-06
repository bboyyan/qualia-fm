/** /api routes (docs/08 端點). Everything except health, session and gated auth needs a session. */
import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  HEADERS,
  ChooseGemRequestSchema,
  FeedbackRequestSchema,
  MockScenarioSchema,
  TasteEditRequestSchema,
  TasteHistoryQuerySchema,
  PlanRequestSchema,
  trackKeyOf,
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
import type { ShowHistory } from '../ledger/showHistory.js';
import type { SongDisplayService } from '../services/songDisplayService.js';
import type { TasteService } from '../services/tasteService.js';
import { GemWallError, type GemWallStore } from '../gems/gemWallStore.js';
import { ownerSecretOf, spotifyPublicRoutes, spotifySessionRoutes, type SpotifyServices } from './spotify.js';

export interface ApiDeps {
  readonly songDisplay: SongDisplayService;
  readonly runtime: RealProviderRuntime;
  readonly tts: OpenAITtsProvider;
  readonly config: ServerConfig;
  readonly sessions: SessionStore;
  readonly plans: PlanService;
  readonly tasteService: TasteService;
  readonly showHistory: ShowHistory;
  readonly gems: GemWallStore;
  readonly now: () => number;
  /** 只在 SPOTIFY_ENABLED=true 時存在。 */
  readonly spotify?: SpotifyServices;
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
  // Spotify OAuth：gate 關閉（預設）時一律 FEATURE_RESTRICTED（docs/05, AC27）。
  spotifyPublicRoutes(router, deps);
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
      spotifyOwner: deps.spotify?.auth.ownerStatus(ownerSecretOf(req)) === 'self',
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

/** 品味帳本（BRA-134）：機器可讀清單＋手動改評價／標記。曲名一律由伺服器從自己的節目或帳本查出。 */
function tasteRoutes(router: Router, deps: ApiDeps): void {
  router.get('/taste/marks', async (_req, res) => {
    res.json({ marks: await deps.tasteService.marks() });
  });
  router.post('/taste/marks', async (req, res) => {
    const parsed = TasteEditRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('INVALID_INPUT');
    const { target, ...edit } = parsed.data;
    const resolved = 'trackKey' in target ? target : deps.plans.trackOf(sessionOf(res).id, target.showId, target.segmentId);
    res.json(await deps.tasteService.edit(resolved, edit));
  });
  router.get('/taste/history', async (req, res) => {
    const parsed = TasteHistoryQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError('INVALID_INPUT');
    res.json({ entries: await deps.tasteService.history(parsed.data.trackKey) });
  });
}

const GEM_WALL_UNREADABLE = '寶石牆暫時讀不到，已收的寶石沒有被更動，請稍後再試。';
const GEM_WALL_WRITE_FAILED = '這顆寶石沒有收進寶石牆，請再試一次。';

/** 讀寫失敗明示：損毀檔不覆寫，訊息不帶路徑或檔案內容。 */
function withGemWall<T>(run: () => T): T {
  try { return run(); }
  catch (error) {
    if (!(error instanceof GemWallError)) throw error;
    throw new AppError('INTERNAL', { message: error.failure === 'write' ? GEM_WALL_WRITE_FAILED : GEM_WALL_UNREADABLE });
  }
}

/** 寶石牆（BRA-169）：單人自用，與品味帳本相同不分 session（D-29）；曲名一律由伺服器從自己的節目查出。 */
function gemRoutes(router: Router, deps: ApiDeps): void {
  router.get('/gems', (_req, res) => {
    res.json(withGemWall(() => deps.gems.wall()));
  });
  router.post('/gems', (req, res) => {
    const parsed = ChooseGemRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('INVALID_INPUT');
    const { journeyId, showId, segmentId, palette } = parsed.data;
    const { title, artist } = deps.plans.trackOf(sessionOf(res).id, showId, segmentId);
    const outcome = withGemWall(() => deps.gems.choose({ journeyId, title, artist, trackKey: trackKeyOf(artist, title), palette }));
    res.status(outcome.created ? 201 : 200).json({ gem: outcome.gem, wall: outcome.wall, unlocked: outcome.unlocked });
  });
}

function sessionRoutes(router: Router, deps: ApiDeps): void {
  router.get('/capabilities', (req, res) => {
    // linked 只對擁有者為 true；其他 session 只知道「已由別的裝置連結」，不能把 E 模式打開。
    const owner = deps.spotify?.auth.ownerStatus(ownerSecretOf(req)) ?? 'none';
    res.json(buildCapabilities(deps.config, deps.runtime.statusReason(), { linked: owner === 'self', linkedElsewhere: owner === 'other' }));
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
  spotifySessionRoutes(router, deps);
  planRoutes(router, deps);
  tasteRoutes(router, deps);
  router.get('/show-history', (_req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ shows: deps.showHistory.list() });
  });
  gemRoutes(router, deps);
  router.use(() => {
    throw new AppError('NOT_FOUND');
  });
  return router;
}
