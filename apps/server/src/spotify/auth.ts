/**
 * Spotify Authorization Code + PKCE（無 client secret）。state 與 code_verifier 綁定 session、一次性、10 分鐘失效。
 * refresh token 只存在加密小檔；access token 只在記憶體並在過期前換新。token 與 code 一律不寫日誌。
 */
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { SPOTIFY_SCOPES } from '@qualia/contracts';
import type { SpotifyConfig } from '../config/env.js';
import { AppError } from '../http/errors.js';
import { logger } from '../http/log.js';
import type { SpotifyTokenStore } from './tokenStore.js';

export const SPOTIFY_ACCOUNTS = 'https://accounts.spotify.com';
const PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 50;
/** 提早換新，避免 SDK 拿到即將過期的 token。 */
const REFRESH_MARGIN_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

interface PendingLogin {
  readonly sessionId: string;
  readonly verifier: string;
  readonly expiresAt: number;
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

  /** 產生 state＋code_verifier 綁定 session，回傳 Spotify authorize URL。 */
  beginLogin(sessionId: string): string {
    this.prune();
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(64).toString('base64url');
    this.pending.set(state, { sessionId, verifier, expiresAt: this.now() + PENDING_TTL_MS });
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

  async completeLogin(sessionId: string, state: string, code: string): Promise<void> {
    const entry = this.consumeState(sessionId, state);
    if (!entry) throw new AppError('INVALID_INPUT', { message: 'Spotify 授權已逾時或不屬於這個工作階段。' });
    const token = await this.requestToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri ?? '',
      client_id: this.config.clientId ?? '',
      code_verifier: entry.verifier,
    });
    if (!token.refresh_token) throw new AppError('INTERNAL', { message: 'Spotify 沒有回傳授權，請再試一次。' });
    this.store.save({ refreshToken: token.refresh_token, scope: token.scope ?? '' });
    this.access = { token: token.access_token, expiresAt: this.now() + token.expires_in * 1000 };
  }

  /** 給 SDK／Web API 用的短期 access token；必要時以 refresh token 換新（單一進行中的換新）。 */
  async accessToken(): Promise<AccessToken> {
    const stored = this.store.load();
    if (!stored) {
      this.access = null;
      throw relinkRequired();
    }
    if (this.access && this.access.expiresAt - REFRESH_MARGIN_MS > this.now()) return this.access;
    this.refreshing ??= this.refresh(stored.refreshToken, stored.scope).finally(() => {
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

  private async refresh(refreshToken: string, scope: string): Promise<AccessToken> {
    let token: TokenResponse;
    try {
      token = await this.requestToken({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: this.config.clientId ?? '' });
    } catch (error: unknown) {
      // invalid_grant＝使用者已在 Spotify 撤銷：fail closed，刪檔要求重新連結。
      if (error instanceof AppError && error.code === 'FEATURE_RESTRICTED') {
        this.disconnect();
        logger.error('spotify_refresh_revoked', {});
      }
      throw error;
    }
    if (token.refresh_token) this.store.save({ refreshToken: token.refresh_token, scope: token.scope ?? scope });
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
