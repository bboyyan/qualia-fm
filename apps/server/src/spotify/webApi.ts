/**
 * 最小 Spotify Web API 用戶端（伺服器端帶 token）。只有對應曲目、播放控制與 Loved 加入需要的端點；
 * 回應只取需要的欄位。錯誤轉成固定中文訊息，不回傳 Spotify 原文或 token。
 */
import { z } from 'zod';
import type { SpotifyDevice, SpotifyPlayback } from '@qualia/contracts';
import { AppError } from '../http/errors.js';
import { relinkRequired, type SpotifyAuth } from './auth.js';

export const SPOTIFY_API = 'https://api.spotify.com/v1';
const REQUEST_TIMEOUT_MS = 8000;
/** 2026/02 起 Search limit 上限 10、預設 5；明確送 5。 */
export const SEARCH_LIMIT = 5;
const PLAYLIST_PAGE = 50;
const MAX_PLAYLIST_PAGES = 40;

const ImageSchema = z.object({ url: z.string(), width: z.number().nullable().optional() });
export const ApiTrackSchema = z.object({
  id: z.string(),
  uri: z.string(),
  name: z.string(),
  duration_ms: z.number().int().nonnegative(),
  is_playable: z.boolean().optional(),
  artists: z.array(z.object({ name: z.string() })),
  album: z.object({ name: z.string().optional(), images: z.array(ImageSchema) }).optional(),
  external_urls: z.object({ spotify: z.string().optional() }).optional(),
});
export type ApiTrack = z.infer<typeof ApiTrackSchema>;

const SearchSchema = z.object({ tracks: z.object({ items: z.array(z.unknown()) }) });
const DevicesSchema = z.object({ devices: z.array(z.object({ id: z.string().nullable(), name: z.string(), type: z.string(), is_active: z.boolean() })) });
const PlayerSchema = z.object({
  device: z.object({ id: z.string().nullable() }).nullable().optional(),
  is_playing: z.boolean(),
  progress_ms: z.number().int().nullable().optional(),
  item: z.object({ uri: z.string(), duration_ms: z.number().int().optional() }).nullable().optional(),
});
const PlaylistPageSchema = z.object({
  items: z.array(z.object({ item: z.object({ uri: z.string() }).nullable().optional(), track: z.object({ uri: z.string() }).nullable().optional() })),
  next: z.string().nullable(),
});
const ErrorBodySchema = z.object({ error: z.object({ reason: z.string().optional() }).optional() });

interface CallOptions {
  readonly query?: Record<string, string>;
  readonly body?: unknown;
  readonly player?: boolean;
  readonly signal?: AbortSignal;
}

async function reasonOf(response: Response): Promise<string | undefined> {
  const parsed = ErrorBodySchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error?.reason : undefined;
}

async function toAppError(response: Response, player: boolean): Promise<AppError> {
  const reason = await reasonOf(response);
  if (response.status === 404 && player) return new AppError('DEVICE_UNAVAILABLE', { message: '播放裝置不在 Spotify 的裝置清單裡（可能暫停太久被收起來了）。' });
  if (response.status === 403 && reason === 'PREMIUM_REQUIRED') return new AppError('SPOTIFY_ACCOUNT_ERROR', { message: '這個 Spotify 帳號不能在這裡播放（需要 Premium）。' });
  if (response.status === 403) return new AppError('SPOTIFY_NOT_ALLOWLISTED', { message: 'Spotify 拒絕這個操作（帳號可能不在開發者 allowlist）。' });
  if (response.status === 429) {
    const seconds = Number(response.headers.get('Retry-After'));
    return new AppError('RATE_LIMITED', { message: 'Spotify 請求太頻繁，請稍後再試。', retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 5000 });
  }
  return new AppError('NETWORK_ERROR', { message: 'Spotify 暫時沒有回應，請稍後再試。' });
}

export class SpotifyWebApi {
  constructor(
    private readonly auth: SpotifyAuth,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async searchTracks(query: string, signal?: AbortSignal): Promise<ApiTrack[]> {
    const raw = await this.call('GET', '/search', { query: { q: query, type: 'track', limit: String(SEARCH_LIMIT), market: 'from_token' }, signal });
    return SearchSchema.parse(raw).tracks.items.flatMap((item) => {
      const parsed = ApiTrackSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  }

  async devices(): Promise<SpotifyDevice[]> {
    const raw = DevicesSchema.parse(await this.call('GET', '/me/player/devices', { player: true }));
    return raw.devices.flatMap((d) => (d.id ? [{ id: d.id, name: d.name.slice(0, 200), type: d.type.slice(0, 40), isActive: d.is_active }] : []));
  }

  async play(deviceId: string, uri: string, positionMs: number): Promise<void> {
    await this.call('PUT', '/me/player/play', { query: { device_id: deviceId }, body: { uris: [uri], position_ms: positionMs }, player: true });
  }

  async pause(deviceId: string): Promise<void> {
    await this.call('PUT', '/me/player/pause', { query: { device_id: deviceId }, player: true });
  }

  async playback(): Promise<SpotifyPlayback> {
    const raw = await this.call('GET', '/me/player', { player: true });
    if (raw === null) return { deviceId: null, isPlaying: false, uri: null, progressMs: 0, durationMs: null };
    const player = PlayerSchema.parse(raw);
    return {
      deviceId: player.device?.id ?? null,
      isPlaying: player.is_playing,
      uri: player.item?.uri ?? null,
      progressMs: Math.max(0, player.progress_ms ?? 0),
      durationMs: player.item?.duration_ms ?? null,
    };
  }

  /** 去重：逐頁讀取歌單項目（只要 uri 欄位），找到即停。 */
  async playlistHas(playlistId: string, uri: string): Promise<boolean> {
    for (let page = 0; page < MAX_PLAYLIST_PAGES; page += 1) {
      const raw = await this.call('GET', `/playlists/${playlistId}/items`, { query: { limit: String(PLAYLIST_PAGE), offset: String(page * PLAYLIST_PAGE), fields: 'items(item(uri),track(uri)),next' } });
      const parsed = PlaylistPageSchema.parse(raw);
      if (parsed.items.some((entry) => (entry.item ?? entry.track)?.uri === uri)) return true;
      if (!parsed.next) return false;
    }
    throw new AppError('INTERNAL', { message: 'Qualia Loved 歌單太長，無法確認是否重複，這次先不加入。' });
  }

  /** 只加不刪：本用戶端沒有任何刪除歌單項目的方法。 */
  async addToPlaylist(playlistId: string, uri: string): Promise<void> {
    await this.call('POST', `/playlists/${playlistId}/items`, { body: { uris: [uri] } });
  }

  private async call(method: 'GET' | 'PUT' | 'POST', path: string, options: CallOptions = {}): Promise<unknown> {
    const first = await this.send(method, path, options);
    const response = first.status === 401 ? (this.auth.invalidateAccess(), await this.send(method, path, options)) : first;
    if (response.status === 401) throw relinkRequired();
    if (!response.ok) throw await toAppError(response, options.player ?? false);
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : null;
  }

  private async send(method: string, path: string, options: CallOptions): Promise<Response> {
    const { token } = await this.auth.accessToken();
    const url = new URL(`${SPOTIFY_API}${path}`);
    if (options.query) url.search = new URLSearchParams(options.query).toString();
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    try {
      return await this.fetchImpl(url.toString(), {
        method,
        redirect: 'error',
        signal,
        headers: { Authorization: ['Bearer', token].join(' '), ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error: unknown) {
      if (options.signal?.aborted) throw error;
      throw new AppError('NETWORK_ERROR', { message: 'Spotify 暫時連不上，請稍後再試。' });
    }
  }
}
