/**
 * 分享路由（BRA-129）。
 * - /api/share：只在現有 session（cookie＋CSRF）內可用；建立、解析、記事件。
 * - /api/public：L2 公開唯讀，feature flag 預設關閉；關閉時整個前綴回 404（不先要求 session，避免回 401 洩漏存在）。
 */
import { Router, type Request, type RequestHandler } from 'express';
import {
  CreateShareRequestSchema,
  SHARE_CODE,
  ShareEventRequestSchema,
  spotifySearchUrl,
  type ShareRecord,
  type ShareView,
} from '@qualia/contracts';
import { AppError } from '../http/errors.js';
import { logger } from '../http/log.js';
import { requireCsrf, requireSession } from '../security/guards.js';
import { WindowLimiter } from '../security/rateLimit.js';
import type { SessionStore } from '../security/sessions.js';
import { ShareStoreError, type ShareStore } from './shareStore.js';

export interface ShareRouteDeps {
  readonly store: ShareStore;
  readonly sessions: SessionStore;
  readonly allowedOrigins: readonly string[];
  readonly publicEnabled: boolean;
  readonly rateLimitPerMin: number;
  readonly now: () => number;
}

function codeOf(req: Request): string {
  const code = req.params.code;
  if (typeof code !== 'string' || !SHARE_CODE.test(code)) throw new AppError('NOT_FOUND');
  return code;
}

/** 讀不到／損毀／寫不進分享檔：記錄失敗種類（不含內容）後回 INTERNAL。 */
function guarded<T>(operation: () => T): T {
  try { return operation(); }
  catch (error) {
    if (error instanceof ShareStoreError) {
      logger.error('share_store_failed', { failure: error.failure });
      throw new AppError('INTERNAL');
    }
    throw error;
  }
}

function tracksOf(record: ShareRecord): ShareView['tracks'] {
  return record.tracks.map((track) => ({ ...track, spotifyUrl: spotifySearchUrl(track.title, track.artist) }));
}

function viewOf(record: ShareRecord, publicEnabled: boolean): ShareView {
  return { code: record.code, selectionNo: record.selectionNo, createdAt: record.createdAt, tracks: tracksOf(record), counts: { ...record.counts }, publicLinkEnabled: publicEnabled };
}

const notFound: RequestHandler = () => {
  throw new AppError('NOT_FOUND');
};

export function createShareRouter(deps: ShareRouteDeps): Router {
  const router = Router();
  router.use(requireSession(deps.sessions, deps.now), requireCsrf(deps.allowedOrigins));
  router.post('/', (req, res) => {
    const parsed = CreateShareRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('INVALID_INPUT');
    const record = guarded(() => deps.store.create(parsed.data));
    logger.info('share_event', { kind: 'shared' });
    res.status(201).json(viewOf(record, deps.publicEnabled));
  });
  router.get('/:code', (req, res) => {
    const record = guarded(() => deps.store.find(codeOf(req)));
    if (!record) throw new AppError('NOT_FOUND');
    res.json(viewOf(record, deps.publicEnabled));
  });
  router.post('/:code/events', (req, res) => {
    const code = codeOf(req);
    const parsed = ShareEventRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('INVALID_INPUT');
    const counts = guarded(() => deps.store.record(code, parsed.data.kind));
    if (!counts) throw new AppError('NOT_FOUND');
    logger.info('share_event', { kind: parsed.data.kind });
    res.json(counts);
  });
  router.use(notFound);
  return router;
}

/** L2 公開唯讀：預設整個前綴 404；開啟時只回五首（不含計數），並依 IP 限流。 */
export function createPublicShareRouter(deps: ShareRouteDeps): Router {
  const router = Router();
  if (!deps.publicEnabled) {
    router.use(notFound);
    return router;
  }
  const limiter = new WindowLimiter(deps.rateLimitPerMin, 60_000);
  router.get('/share/:code', (req, res) => {
    const limit = limiter.hit(req.ip ?? 'unknown', deps.now());
    if (!limit.ok) throw new AppError('RATE_LIMITED', { retryAfterMs: limit.retryAfterMs });
    const record = guarded(() => deps.store.find(codeOf(req)));
    if (!record) throw new AppError('NOT_FOUND');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ selectionNo: record.selectionNo, tracks: tracksOf(record) });
  });
  router.use(notFound);
  return router;
}
