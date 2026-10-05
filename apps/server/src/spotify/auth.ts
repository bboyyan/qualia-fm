/**
 * Spotify Authorization Code + PKCE（無 client secret）。state 與 code_verifier 綁定 session、一次性、10 分鐘失效。
 * refresh token 只存在加密小檔；access token 只在記憶體並在過期前換新。token 與 code 一律不寫日誌。
 * 擁有者（BRA-111 A1）：完成登入時發一組擁有者憑證（只給那個瀏覽器的 HttpOnly cookie），token 檔只存它的雜湊；
 * 之後只有出示同一憑證的請求能用這份連結。已由別人連結時不能開始登入；登入途中若擁有者變了，回呼一律拒絕。
 * 帳號比對（審查必修）：換到 token 後呼叫一次 Spotify `/v1/me`，只讀 `id`，必須等於 SPOTIFY_OWNER_USER_ID 才存檔、發憑證；
 * 未設定 SPOTIFY_OWNER_USER_ID 一律拒絕（fail closed）。/me 回傳的名稱、email 等不保存、不寫日誌。
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { SPOTIFY_SCOPES } from '@qualia/contracts';
import type { SpotifyConfig } from '../config/env.js';
import { AppError } from '../http/errors.js';
import { logger } from '../http/log.js';
import type { SpotifyTokenStore, StoredSpotifyToken } from './tokenStore.js';

export const SPOTIFY_ACCOUNTS = 'https://accounts.spotify.com';
const PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 50;
/** 提早換新，避免 SDK 拿到即將過期的 token。 */
const REFRESH_MARGIN_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
/** 只用來在連結時確認是哪個 Spotify 帳號；不呼叫其他讀取個人資料的 API。 */
const SPOTIFY_ME = 'https://api.spotify.com/v1/me';
const MeSchema = z.object({ id: z.string().min(1).max(200) });

interface PendingLogin {
  readonly sessionId: string;
  readonly verifier: string;
  readonly expiresAt: number;
  /** 開始登入時的擁有者雜湊（未連結為 null）；回呼時不同＝期間有別人連結，拒絕覆蓋。 */
  readonly ownerHash: string | null;
}

/** none＝未連結；self＝出示的憑證是擁有者；other＝已由別人連結。 */
export type OwnerStatus = 'none' | 'self' | 'other';

const OWNER_SECRET = /^[A-Za-z0-9_-]{43}$/;
const hashOwner = (secret: string): string => createHash('sha256').update(secret).digest('base64url');

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface AccessToken {
  readonly token: string;
  readonly expiresAt: number;
}

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
  refresh_token: z.string().min(1).optional(),
});
type TokenResponse = z.infer<typeof TokenResponseSchema>;

export const relinkRequired = (): AppError => new AppError('FEATURE_RESTRICTED', { message: 'Spotify 授權已失效或尚未連結，請到設定重新連結。' });
export const notOwner = (): AppError => new AppError('FEATURE_RESTRICTED', { message: '這個 Spotify 連結只有完成連結的擁有者（那台裝置的瀏覽器）能使用。' });
/** 登入途中擁有者變了（別人先完成連結）。 */
export class OwnerChangedError extends Error {}
/** 未設定 SPOTIFY_OWNER_USER_ID：任何人都不能成為擁有者。 */
export class OwnerNotConfiguredError extends Error {}
/** 完成授權的 Spotify 帳號不是 SPOTIFY_OWNER_USER_ID。 */
export class OwnerMismatchError extends Error {}

export class SpotifyAuth {
  private readonly pending = new Map<string, PendingLogin>();
  private access: AccessToken | null = null;
  private refreshing: Promise<AccessToken> | null = null;

  constructor(
    private readonly config: SpotifyConfig,
    private readonly store: SpotifyTokenStore,
    private readonly fetchImpl: typeof fetch,
    private readonly now: () => number,
  ) {}

  /** 以 token 檔為準（中斷連結或人工刪檔後立即視為未連結）。 */
  isLinked(): boolean {
    return this.store.load() !== null;
  }

  /** 出示的擁有者憑證（cookie 值，可能缺）與 token 檔裡的雜湊比對；以常數時間比較。 */
  ownerStatus(secret: string | undefined): OwnerStatus {
    const stored = this.store.load();
    if (!stored) return 'none';
    return secret !== undefined && OWNER_SECRET.test(secret) && sameHash(hashOwner(secret), stored.ownerHash) ? 'self' : 'other';
  }

  /** 產生 state＋code_verifier 綁定 session（與當下的擁有者），回傳 Spotify authorize URL。呼叫端須先確認不是 other。 */
  beginLogin(sessionId: string): string {
    this.prune();
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(64).toString('base64url');
    const ownerHash = this.store.load()?.ownerHash ?? null;
    this.pending.set(state, { sessionId, verifier, expiresAt: this.now() + PENDING_TTL_MS, ownerHash });
    const url = new URL('/authorize', SPOTIFY_ACCOUNTS);
    url.search = new URLSearchParams({
      client_id: this.config.clientId ?? '',
      response_type: 'code',
      redirect_uri: this.config.redirectUri ?? '',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      state,
      scope: SPOTIFY_SCOPES.join(' '),
    }).toString();
    return url.toString();
  }

  /** 取回並刪除 state（一次性）；不符 session 或逾時視為無效。 */
  consumeState(sessionId: string, state: string): PendingLogin | null {
    const entry = this.pending.get(state);
    if (!entry) return null;
    this.pending.delete(state);
    return entry.sessionId === sessionId && entry.expiresAt > this.now() ? entry : null;
  }

  /** 完成登入並回傳新的擁有者憑證（只交給這個瀏覽器的 cookie；伺服器只存雜湊）。 */
  async completeLogin(sessionId: string, state: string, code: string): Promise<string> {
    const entry = this.consumeState(sessionId, state);
    if (!entry) throw new AppError('INVALID_INPUT', { message: 'Spotify 授權已逾時或不屬於這個工作階段。' });
    const ownerUserId = this.config.ownerUserId;
    if (!ownerUserId) throw new OwnerNotConfiguredError();
    if ((this.store.load()?.ownerHash ?? null) !== entry.ownerHash) throw new OwnerChangedError();
    const token = await this.requestToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri ?? '',
      client_id: this.config.clientId ?? '',
      code_verifier: entry.verifier,
    });
    if (!token.refresh_token) throw new AppError('INTERNAL', { message: 'Spotify 沒有回傳授權，請再試一次。' });
    // 帳號不對就什麼都不留：不存檔、不快取 access token、不發憑證。
    if ((await this.spotifyUserId(token.access_token)) !== ownerUserId) throw new OwnerMismatchError();
    const secret = randomBytes(32).toString('base64url');
    this.store.save({ refreshToken: token.refresh_token, scope: token.scope ?? '', ownerHash: hashOwner(secret) });
    this.access = { token: token.access_token, expiresAt: this.now() + token.expires_in * 1000 };
    return secret;
  }

  /** 是否設定了唯一可連結的 Spotify 帳號（未設定時不開始登入）。 */
  ownerConfigured(): boolean {
    return Boolean(this.config.ownerUserId);
  }

  /** 完成授權的是哪個 Spotify 帳號：只取 /v1/me 的 id。 */
  private async spotifyUserId(accessToken: string): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(SPOTIFY_ME, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { Authorization: ['Bearer', accessToken].join(' ') },
      });
    } catch {
      throw new AppError('NETWORK_ERROR', { message: 'Spotify 暫時連不上，請稍後再試。' });
    }
    if (!response.ok) {
      logger.error('spotify_me_failed', { status: response.status });
      throw new AppError('NETWORK_ERROR', { message: 'Spotify 暫時沒有回應，請稍後再試。' });
    }
    const parsed = MeSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new AppError('INTERNAL', { message: 'Spotify 帳號回應格式不正確。' });
    return parsed.data.id;
  }

  /** 給 SDK／Web API 用的短期 access token；必要時以 refresh token 換新（單一進行中的換新）。 */
  async accessToken(): Promise<AccessToken> {
    const stored = this.store.load();
    if (!stored) {
      this.access = null;
      throw relinkRequired();
    }
    if (this.access && this.access.expiresAt - REFRESH_MARGIN_MS > this.now()) return this.access;
    this.refreshing ??= this.refresh(stored).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** Web API 回 401 時丟掉快取，下一次強制換新。 */
  invalidateAccess(): void {
    this.access = null;
  }

  /** 中斷連結：刪除 token 檔與記憶體中的一切授權狀態。 */
  disconnect(): void {
    this.store.clear();
    this.access = null;
    this.pending.clear();
  }

  private async refresh(stored: StoredSpotifyToken): Promise<AccessToken> {
    let token: TokenResponse;
    try {
      token = await this.requestToken({ grant_type: 'refresh_token', refresh_token: stored.refreshToken, client_id: this.config.clientId ?? '' });
    } catch (error: unknown) {
      // invalid_grant＝使用者已在 Spotify 撤銷：fail closed，刪檔要求重新連結。
      if (error instanceof AppError && error.code === 'FEATURE_RESTRICTED') {
        this.disconnect();
        logger.error('spotify_refresh_revoked', {});
      }
      throw error;
    }
    if (token.refresh_token) this.store.save({ refreshToken: token.refresh_token, scope: token.scope ?? stored.scope, ownerHash: stored.ownerHash });
    this.access = { token: token.access_token, expiresAt: this.now() + token.expires_in * 1000 };
    return this.access;
  }

  private async requestToken(form: Record<string, string>): Promise<TokenResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${SPOTIFY_ACCOUNTS}/api/token`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
      });
    } catch {
      throw new AppError('NETWORK_ERROR', { message: 'Spotify 暫時連不上，請稍後再試。' });
    }
    if (response.status === 400 || response.status === 401) {
      logger.error('spotify_token_rejected', { status: response.status });
      throw relinkRequired();
    }
    if (!response.ok) throw new AppError('NETWORK_ERROR', { message: 'Spotify 暫時沒有回應，請稍後再試。' });
    const parsed = TokenResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new AppError('INTERNAL', { message: 'Spotify 授權回應格式不正確。' });
    return parsed.data;
  }

  private prune(): void {
    const now = this.now();
    for (const [state, entry] of this.pending) if (entry.expiresAt <= now) this.pending.delete(state);
    while (this.pending.size >= MAX_PENDING) {
      const oldest = this.pending.keys().next().value;
      if (oldest === undefined) break;
      this.pending.delete(oldest);
    }
  }
}
