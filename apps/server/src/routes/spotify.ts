/**
 * Spotify 路由。伺服器是唯一權威：每個端點先過 capability gate（不看 query／body／模型輸出）。
 * - spotify_auth（SPOTIFY_ENABLED）：登入、回呼、中斷連結。
 * - spotify_playback（SPOTIFY_ENABLED）：「愛」→ Qualia Loved。
 * - spotify_dj（E 模式核可）：SDK 用短期 token、播放代理（一律帶 device_id）。
 */
import type { Request, RequestHandler, Response, Router } from 'express';
import { LovedRequestSchema, SpotifyPauseRequestSchema, SpotifyPlayRequestSchema } from '@qualia/contracts';
import { AppError } from '../http/errors.js';
import { logger } from '../http/log.js';
import { assertAllowedOrigin, sessionOf } from '../security/guards.js';
import { WindowLimiter } from '../security/rateLimit.js';
import { SESSION_COOKIE, readCookie } from '../security/sessions.js';
import { assertFeatureAllowed } from '../services/capabilities.js';
import { relinkRequired, type SpotifyAuth } from '../spotify/auth.js';
import type { LovedPlaylist } from '../spotify/loved.js';
import type { SpotifyWebApi } from '../spotify/webApi.js';
import type { ApiDeps } from './api.js';

export interface SpotifyServices {
  readonly auth: SpotifyAuth;
  readonly api: SpotifyWebApi;
  readonly loved: LovedPlaylist;
}

const LOGIN_LIMIT_PER_MIN = 10;
const CONTROL_LIMIT_PER_MIN = 240;
type LinkOutcome = 'linked' | 'denied' | 'error' | 'session';

function servicesOf(deps: ApiDeps): SpotifyServices {
  if (!deps.spotify) throw new AppError('FEATURE_RESTRICTED');
  return deps.spotify;
}

/** 導回 App 並以 query 告知結果；不帶任何 code／state。 */
function backToApp(res: Response, outcome: LinkOutcome): void {
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(303, `/?spotify=${outcome}`);
}

const queryString = (req: Request, name: string): string => {
  const value = req.query[name];
  return typeof value === 'string' && value.length <= 2000 ? value : '';
};

/** `/callback`（Spotify 後台登記的路徑）與 `/api/auth/spotify/callback` 共用。 */
export function spotifyCallback(deps: ApiDeps): RequestHandler {
  return async (req, res) => {
    assertFeatureAllowed(deps.config, 'spotify_auth');
    const { auth } = servicesOf(deps);
    const session = deps.sessions.get(readCookie(req.get('cookie'), SESSION_COOKIE), deps.now());
    const state = queryString(req, 'state');
    const code = queryString(req, 'code');
    if (!session || !state) return backToApp(res, 'error');
    if (queryString(req, 'error')) {
      auth.consumeState(session.id, state);
      return backToApp(res, 'denied');
    }
    if (!code) {
      auth.consumeState(session.id, state);
      return backToApp(res, 'error');
    }
    try {
      await auth.completeLogin(session.id, state, code);
      logger.info('spotify_linked', {});
      backToApp(res, 'linked');
    } catch (error: unknown) {
      logger.error('spotify_link_failed', { code: error instanceof AppError ? error.code : 'INTERNAL' });
      backToApp(res, 'error');
    }
  };
}

/** 掛在 requireSession 之前：login 是頂層導覽（無法帶 CSRF header），以 session cookie＋同源檢查保護。 */
export function spotifyPublicRoutes(router: Router, deps: ApiDeps): void {
  const limiter = new WindowLimiter(LOGIN_LIMIT_PER_MIN, 60_000);
  router.use('/auth/spotify', (_req, _res, next) => {
    assertFeatureAllowed(deps.config, 'spotify_auth');
    next();
  });
  router.get('/auth/spotify/login', (req, res) => {
    assertAllowedOrigin(req, deps.config.allowedOrigins);
    const { auth } = servicesOf(deps);
    const session = deps.sessions.get(readCookie(req.get('cookie'), SESSION_COOKIE), deps.now());
    if (!session) return backToApp(res, 'session');
    const limit = limiter.hit(session.id, deps.now());
    if (!limit.ok) throw new AppError('RATE_LIMITED', { retryAfterMs: limit.retryAfterMs });
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, auth.beginLogin(session.id));
  });
  router.get('/auth/spotify/callback', spotifyCallback(deps));
}

/** 掛在 requireSession＋requireCsrf 之後。 */
export function spotifySessionRoutes(router: Router, deps: ApiDeps): void {
  const limiter = new WindowLimiter(CONTROL_LIMIT_PER_MIN, 60_000);
  router.use('/spotify', (_req, res, next) => {
    const limit = limiter.hit(sessionOf(res).id, deps.now());
    if (!limit.ok) throw new AppError('RATE_LIMITED', { retryAfterMs: limit.retryAfterMs });
    next();
  });
  router.post('/auth/spotify/logout', (_req, res) => {
    servicesOf(deps).auth.disconnect();
    deps.plans.scrubSpotify();
    logger.info('spotify_disconnected', {});
    res.status(204).end();
  });
  router.post('/spotify/token', async (_req, res) => {
    assertFeatureAllowed(deps.config, 'spotify_dj');
    const token = await servicesOf(deps).auth.accessToken();
    res.json({ accessToken: token.token, expiresAt: new Date(token.expiresAt).toISOString() });
  });
  router.get('/spotify/devices', async (_req, res) => {
    assertFeatureAllowed(deps.config, 'spotify_dj');
    res.json({ devices: await servicesOf(deps).api.devices() });
  });
  router.get('/spotify/playback', async (_req, res) => {
    assertFeatureAllowed(deps.config, 'spotify_dj');
    res.json(await servicesOf(deps).api.playback());
  });
  router.post('/spotify/play', async (req, res) => {
    assertFeatureAllowed(deps.config, 'spotify_dj');
    const parsed = SpotifyPlayRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('INVALID_INPUT');
    // 只播本 session 節目裡由伺服器對應出的曲目，不做通用遙控器。
    if (!deps.plans.ownsSpotifyUri(sessionOf(res).id, parsed.data.uri)) throw new AppError('NOT_FOUND');
    await servicesOf(deps).api.play(parsed.data.deviceId, parsed.data.uri, parsed.data.positionMs);
    res.status(204).end();
  });
  router.post('/spotify/pause', async (req, res) => {
    assertFeatureAllowed(deps.config, 'spotify_dj');
    const parsed = SpotifyPauseRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('INVALID_INPUT');
    await servicesOf(deps).api.pause(parsed.data.deviceId);
    res.status(204).end();
  });
  router.post('/spotify/loved', async (req, res) => {
    assertFeatureAllowed(deps.config, 'spotify_playback');
    const parsed = LovedRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('INVALID_INPUT');
    const services = servicesOf(deps);
    if (!services.auth.isLinked()) throw relinkRequired();
    const uri = deps.plans.spotifyUriFor(sessionOf(res).id, parsed.data.showId, parsed.data.segmentId);
    res.json(await services.loved.add(uri));
  });
}
