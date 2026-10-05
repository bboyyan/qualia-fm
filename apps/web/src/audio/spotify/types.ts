/**
 * Spotify 播放輸出的共用型別。路徑 P（網頁當 Connect 裝置）與路徑 C（遙控 Spotify app）
 * 都實作 SpotifyOutput，由 PlaybackRouter 決定何時交給它們。
 */
import type { SpotifyDevice, SpotifyPlayback, SpotifyPlayRequest, SpotifyToken } from '@qualia/contracts';
import { ApiError } from '../../api/client';
import type { MediaAdapter } from '../types';

export type SpotifyPath = 'P' | 'C';
export type DeviceState = 'idle' | 'connecting' | 'online' | 'offline';
/** 離線原因：決定要顯示哪一種友善提示。 */
export type DeviceReason = 'not_found' | 'paused_too_long' | 'account' | 'auth' | 'sdk' | null;

export interface SpotifyDeviceStatus {
  readonly path: SpotifyPath;
  readonly state: DeviceState;
  readonly deviceName: string | null;
  readonly reason: DeviceReason;
}

/** 伺服器播放代理（token 留在伺服器；指令一律帶 device_id）。 */
export interface SpotifyRemote {
  token(): Promise<SpotifyToken>;
  devices(): Promise<SpotifyDevice[]>;
  playback(): Promise<SpotifyPlayback>;
  play(request: SpotifyPlayRequest): Promise<void>;
  pause(deviceId: string): Promise<void>;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** 只在頁面可見時輪詢；回到前景立即重新確認。 */
export interface Visibility {
  isVisible(): boolean;
  onChange(listener: (visible: boolean) => void): () => void;
}

export interface SpotifyOutput extends MediaAdapter {
  readonly path: SpotifyPath;
  /** 目前是否確定有 Spotify 聲音在出。 */
  isAudible(): boolean;
  /** 等到確認靜音（或逾時回 false）；介紹語音只在確認靜音後才開始。 */
  whenSilent(timeoutMs: number): Promise<boolean>;
  /** 「重新偵測」：重新確認裝置是否在；fromGesture 時可重新接上播放器。 */
  recheck(fromGesture: boolean): Promise<boolean>;
}

/** 暫停超過約 10 分鐘，Spotify Connect 官方說明可能需要重新連線：一律先重新確認，不直接續播。 */
export const PAUSE_RECONNECT_MS = 10 * 60 * 1000;

export const gestureNeeded = (): DOMException => new DOMException('需要點一下才能繼續播放。', 'NotAllowedError');
export const deviceUnavailable = (): DOMException => new DOMException('播放裝置目前不在。', 'DeviceUnavailableError');
export const notSupported = (message: string): DOMException => new DOMException(message, 'NotSupportedError');

/** 伺服器播放代理的錯誤 → 離線原因；'other' 表示不是裝置問題（交給引擎當成這首無法播放）。 */
export function remoteReason(error: unknown): Exclude<DeviceReason, null> | 'other' {
  if (!(error instanceof ApiError)) return 'other';
  switch (error.code) {
    case 'DEVICE_UNAVAILABLE':
      return 'not_found';
    case 'SPOTIFY_ACCOUNT_ERROR':
    case 'SPOTIFY_NOT_ALLOWLISTED':
      return 'account';
    case 'FEATURE_RESTRICTED':
      return 'auth';
    default:
      return 'other';
  }
}

export const browserTimers: Timers = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
};

export const documentVisibility: Visibility = {
  isVisible: () => document.visibilityState === 'visible',
  onChange: (listener) => {
    const handler = () => listener(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  },
};

/** 只在使用者剛點擊的短暫期間為 true（navigator.userActivation）；不支援時視為沒有手勢，改走「點一下繼續」。 */
export const hasTransientActivation = (): boolean =>
  (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive ?? false;
