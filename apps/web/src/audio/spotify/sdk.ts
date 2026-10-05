/**
 * Spotify Web Playback SDK 的最小可注入介面與動態載入器。
 * 不安裝 npm 套件：只在 E 模式且使用者點擊後，以 <script> 載入官方 https://sdk.scdn.co/spotify-player.js。
 */
export const SPOTIFY_SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
const LOAD_TIMEOUT_MS = 15_000;

export interface SdkTrack {
  readonly uri: string;
}

export interface SdkPlaybackState {
  readonly paused: boolean;
  readonly position: number;
  readonly duration: number;
  readonly track_window: {
    readonly current_track: SdkTrack | null;
    readonly previous_tracks: readonly SdkTrack[];
  };
}

export interface SdkPlayerOptions {
  readonly name: string;
  readonly getOAuthToken: (callback: (token: string) => void) => void;
}

export type SdkEventName =
  | 'ready'
  | 'not_ready'
  | 'player_state_changed'
  | 'autoplay_failed'
  | 'initialization_error'
  | 'authentication_error'
  | 'account_error'
  | 'playback_error';

export interface SdkPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  activateElement(): Promise<void>;
  addListener(event: SdkEventName, listener: (payload: unknown) => void): boolean;
  removeListener(event: SdkEventName): boolean;
  getCurrentState(): Promise<SdkPlaybackState | null>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionMs: number): Promise<void>;
}

export interface SpotifySdk {
  createPlayer(options: SdkPlayerOptions): SdkPlayer;
}

export type SdkLoader = () => Promise<SpotifySdk>;

interface SpotifyGlobal {
  Player: new (options: SdkPlayerOptions) => SdkPlayer;
}

type SdkWindow = Window & { Spotify?: SpotifyGlobal; onSpotifyWebPlaybackSDKReady?: () => void };

let pending: Promise<SpotifySdk> | null = null;

/** 單例載入；失敗後允許下一次點擊重試。 */
export const loadSpotifySdk: SdkLoader = () => {
  pending ??= new Promise<SpotifySdk>((resolve, reject) => {
    const win = window as SdkWindow;
    const wrap = (global: SpotifyGlobal): SpotifySdk => ({ createPlayer: (options) => new global.Player(options) });
    if (win.Spotify?.Player) return resolve(wrap(win.Spotify));
    const timer = window.setTimeout(() => reject(new Error('Spotify SDK load timeout')), LOAD_TIMEOUT_MS);
    win.onSpotifyWebPlaybackSDKReady = () => {
      window.clearTimeout(timer);
      if (win.Spotify?.Player) resolve(wrap(win.Spotify));
      else reject(new Error('Spotify SDK missing Player'));
    };
    const script = document.createElement('script');
    script.src = SPOTIFY_SDK_URL;
    script.async = true;
    script.dataset.qfmSpotifySdk = 'true';
    script.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('Spotify SDK failed to load'));
    };
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
};
