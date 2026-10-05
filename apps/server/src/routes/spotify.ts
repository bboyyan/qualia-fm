/**
 * Spotify 路由。伺服器是唯一權威：每個端點先過 capability gate（不看 query／body／模型輸出）。
 * - spotify_auth（SPOTIFY_ENABLED）：登入、回呼、中斷連結。
 * - spotify_playback（SPOTIFY_ENABLED）：「愛」→ Qualia Loved。
 * - spotify_dj（E 模式核可）：SDK 用短期 token、播放代理（一律帶 device_id）。
 * 擁有者（BRA-111 A1）：除了登入本身，所有 Spotify 端點都要出示擁有者憑證（完成連結時發給那個瀏覽器的 HttpOnly cookie）。
 */
import type { Request, RequestHandler, Response, Router } from 'express';
import { LovedRequestSchema, SpotifyPauseRequestSchema, SpotifyPlayRequestSchema } from '@qualia/contracts';
import { AppError } from '../http/errors.js';
import { logger } from '../http/log.js';
import { assertAllowedOrigin, sessionOf } from '../security/guards.js';
import { WindowLimiter } from '../security/rateLimit.js';
import { SESSION_COOKIE, readCookie } from '../security/sessions.js';
import { assertFeatureAllowed } from '../services/capabilities.js';
import { OwnerChangedError, OwnerMismatchError, OwnerNotConfiguredError, notOwner, relinkRequired, type SpotifyAuth } from '../spotify/auth.js';
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
/** owner＝已由別人連結；account＝不是 SPOTIFY_OWNER_USER_ID 的帳號；unconfigured＝未設定 SPOTIFY_OWNER_USER_ID。 */
type LinkOutcome = 'linked' | 'denied' | 'error' | 'session' | 'owner' | 'account' | 'unconfigured';

export const SPOTIFY_OWNER_COOKIE = 'qfm_spotify_owner';
/** 擁有者憑證與 refresh token 同樣長效；中斷連結或重新連結時更換。 */
const OWNER_COOKIE_MAX_AGE_S = 180 * 24 * 60 * 60;

const ownerCookie = (secret: string, secure: boolean): string =>
  `${SPOTIFY_OWNER_COOKIE}=${secret}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${OWNER_COOKIE_MAX_AGE_S}${secure ? '; Secure' : ''}`;
const clearedOwnerCookie = (secure: boolean): string =>
  `${SPOTIFY_OWNER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

/** 請求帶的擁有者憑證（cookie 值）；沒有就是 undefined。 */
export const ownerSecretOf = (req: Request): string | undefined => readCookie(req.get('cookie'), SPOTIFY_OWNER_COOKIE);

function servicesOf(deps: ApiDeps): SpotifyServices {
  if (!deps.spotify) throw new AppError('FEATURE_RESTRICTED');
  return deps.spotify;
}

/** 只有擁有者能用：未連結 → 請重新連結；已由別人連結 → 拒絕（不透露任何擁有者資訊）。 */
function ownerServices(req: Request, deps: ApiDeps): SpotifyServices {
  const services = servicesOf(deps);
  const status = services.auth.ownerStatus(ownerSecretOf(req));
  if (status === 'none') throw relinkRequired();
  if (status === 'other') throw notOwner();
  return services;
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
      const secret = await auth.completeLogin(session.id, state, code);
      logger.info('spotify_linked', {});
      res.setHeader('Set-Cookie', ownerCookie(secret, deps.config.secureCookies));
      backToApp(res, 'linked');
    } catch (error: unknown) {
      if (error instanceof OwnerChangedError) {
        logger.info('spotify_link_owner_conflict', {});
        return backToApp(res, 'owner');
      }
      if (error instanceof OwnerMismatchError) {
        // 不記帳號 id：只記「不是指定的擁有者帳號」。
        logger.info('spotify_link_wrong_account', {});
        return backToApp(res, 'account');
      }
      if (error instanceof OwnerNotConfiguredError) return backToApp(res, 'unconfigured');
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
    // 沒有指定擁有者帳號：誰都不能連結（fail closed），也不轉去 Spotify。
    if (!auth.ownerConfigured()) return backToApp(res, 'unconfigured');
    // 已由別人連結：不能開始登入（否則可以覆蓋擁有者）。擁有者自己可以重新連結。
    if (auth.ownerStatus(ownerSecretOf(req)) === 'other') return backToApp(res, 'owner');
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
  router.post('/auth/spotify/logout', (req, res) => {
    ownerServices(req, deps).auth.disconnect();
    deps.plans.scrubSpotify();
    logger.info('spotify_disconnected', {});
    res.setHeader('Set-Cookie', clearedOwnerCookie(deps.config.secureCookies));
    res.status(204).end();
  });
  router.post('/spotify/token', async (req, res) => {
    assertFeatureAllowed(deps.config, 'spotify_dj');
    const token = await ownerServices(req, deps).auth.accessToken();
    res.json({ accessToken: token.token, expiresAt: new Date(token.expiresAt).toISOString() });
  });
  router.get('/spotify/devices', async (req, res) => {
    assertFeatureAllowed(deps.config, 'spotify_dj');
    res.json({ devices: await ownerServices(req, deps).api.devices() });
  });
  router.get('/spotify/playback', async (req, res) => {
    assertFeatureAllowed(deps.config, 'spotify_dj');
    res.json(await ownerServices(req, deps).api.playback());
  });
  router.post('/spotify/play', async (req, res) => {
    assertFeatureAllowed(deps.config, 'spotify_dj');
    const parsed = SpotifyPlayRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('INVALID_INPUT');
    // 只播本 session 節目裡由伺服器對應出的曲目，不做通用遙控器。
    const services = ownerServices(req, deps);
    if (!deps.plans.ownsSpotifyUri(sessionOf(res).id, parsed.data.uri)) throw new AppError('NOT_FOUND');
    await services.api.play(parsed.data.deviceId, parsed.data.uri, parsed.data.positionMs);
    res.status(204).end();
  });
  router.post('/spotify/pause', async (req, res) => {
    assertFeatureAllowed(deps.config, 'spotify_dj');
    const parsed = SpotifyPauseRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('INVALID_INPUT');
    await ownerServices(req, deps).api.pause(parsed.data.deviceId);
    res.status(204).end();
  });
  router.post('/spotify/loved', async (req, res) => {
    assertFeatureAllowed(deps.config, 'spotify_playback');
    const parsed = LovedRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('INVALID_INPUT');
    const services = ownerServices(req, deps);
    const uri = deps.plans.spotifyUriFor(sessionOf(res).id, parsed.data.showId, parsed.data.segmentId);
    res.json(await services.loved.add(uri));
  });
}
