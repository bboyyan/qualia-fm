/**
 * 路徑 P：Qualia 網頁自己當 Spotify Connect 裝置（Web Playback SDK）。
 * - SDK 只在使用者點擊（connect）時載入；有播放器時 activateElement 同步留在手勢內。
 * - 每首前就緒檢查：不在且不在手勢內 → NotAllowedError（點一下繼續）；手勢內 → 重新接上，仍不行 → 裝置離線。
 * - 送出 play（伺服器代理、帶 device_id）後，要等 player_state_changed 確認真的在播才回報 started。
 * - 暫停超過約 10 分鐘視為需重連；只在頁面回到前景時讀狀態；不做靜音保活、wake lock 或背景計時器。
 */
import type { SdkLoader, SdkPlaybackState, SdkPlayer } from '../spotify/sdk';
import {
  PAUSE_RECONNECT_MS,
  deviceUnavailable,
  gestureNeeded,
  notSupported,
  remoteReason,
  type DeviceReason,
  type DeviceState,
  type SpotifyDeviceStatus,
  type SpotifyOutput,
  type SpotifyRemote,
  type Timers,
  type Visibility,
} from '../spotify/types';
import type { AdapterEvent, ProviderState, StartRequest } from '../types';

export { PAUSE_RECONNECT_MS };

const PLAYER_NAME = 'Qualia FM';
const READY_TIMEOUT_MS = 8000;
const CONFIRM_TIMEOUT_MS = 10_000;

export interface WebPlaybackDeps {
  readonly loadSdk: SdkLoader;
  readonly remote: Pick<SpotifyRemote, 'play' | 'token'>;
  readonly timers: Timers;
  readonly now: () => number;
  readonly hasUserGesture: () => boolean;
  readonly visibility: Visibility;
  readonly report?: (status: SpotifyDeviceStatus) => void;
}

interface Attempt {
  readonly attemptId: number;
  readonly uri: string;
  /** 新的一首：送出前的曲目以外的任何曲目開始播放都算確認（Spotify 可能替換成同曲別版本）。 */
  readonly fresh: boolean;
  readonly beforeUri: string | null;
  readonly confirmed: boolean;
  readonly playingUri: string | null;
}

interface Snapshot {
  readonly paused: boolean;
  readonly position: number;
  readonly duration: number;
  readonly at: number;
  readonly uri: string | null;
}

const deviceIdOf = (payload: unknown): string | null => {
  const id = (payload as { device_id?: unknown } | null)?.device_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

export class SpotifyWebPlaybackAdapter implements SpotifyOutput {
  readonly path = 'P' as const;
  private readonly listeners = new Set<(event: AdapterEvent) => void>();
  private player: SdkPlayer | null = null;
  private creating: Promise<SdkPlayer | null> | null = null;
  private connected = false;
  private deviceId: string | null = null;
  private state: DeviceState = 'idle';
  private current: Attempt | null = null;
  private last: Snapshot | null = null;
  private pausedAt: number | null = null;
  private localPause = false;
  private confirmTimer: unknown = null;
  private readyWaiters: ((ok: boolean) => void)[] = [];
  private silentWaiters: (() => void)[] = [];
  private readonly unwatch: () => void;

  constructor(private readonly deps: WebPlaybackDeps) {
    this.unwatch = deps.visibility.onChange((visible) => {
      if (visible) void this.refresh();
    });
  }

  /** 由使用者點擊呼叫（接上播放器／叫醒播放器／點一下繼續）。只有這裡會載入 SDK。 */
  connect(): Promise<boolean> {
    if (this.player) {
      this.activate(this.player);
      return this.reconnect(this.player);
    }
    this.report('connecting', null);
    this.creating ??= this.deps.loadSdk().then(
      (sdk) => this.attach(sdk.createPlayer({ name: PLAYER_NAME, getOAuthToken: (callback) => this.provideToken(callback) })),
      () => null,
    );
    return this.creating.then((player) => {
      this.creating = null;
      if (!player) {
        this.report('offline', 'sdk');
        return false;
      }
      this.activate(player);
      return this.reconnect(player);
    });
  }

  start(request: StartRequest): Promise<void> {
    const locator = request.segment.track.audioLocator;
    if (request.owner !== 'track' || locator.kind !== 'spotify_uri') return Promise.reject(notSupported('Spotify 播放器只播放 Spotify 曲目。'));
    const gesture = this.deps.hasUserGesture();
    this.resetAttempt();
    if (this.isOnline()) return this.play(request, locator.uri);
    if (!gesture) return Promise.reject(gestureNeeded());
    return this.connect().then((ok) => (ok ? this.play(request, locator.uri) : Promise.reject(deviceUnavailable())));
  }

  pause(): void {
    this.localPause = true;
    this.pausedAt = this.deps.now();
    this.clearConfirm();
    void this.player?.pause().catch(() => undefined);
  }

  resume(attemptId: number): Promise<void> {
    const current = this.current;
    if (!current) return Promise.reject(deviceUnavailable());
    if (this.pausedAt !== null && this.deps.now() - this.pausedAt > PAUSE_RECONNECT_MS) {
      this.current = null;
      this.report('offline', 'paused_too_long');
      return Promise.reject(deviceUnavailable());
    }
    if (!this.isOnline()) return Promise.reject(this.deps.hasUserGesture() ? deviceUnavailable() : gestureNeeded());
    this.current = { ...current, attemptId, confirmed: false, fresh: false };
    this.localPause = false;
    this.pausedAt = null;
    void this.player?.resume().catch(() => undefined);
    this.armConfirm(attemptId);
    return Promise.resolve();
  }

  seek(positionMs: number): void {
    void this.player?.seek(positionMs).catch(() => undefined);
  }

  stop(): void {
    const active = this.current !== null || this.isAudible();
    this.resetAttempt();
    this.localPause = true;
    if (active) void this.player?.pause().catch(() => undefined);
  }

  getState(): ProviderState | null {
    if (!this.isOnline()) return null;
    const last = this.last;
    if (!last) return { positionMs: 0, durationMs: null, paused: true, ready: true };
    const duration = last.duration > 0 ? last.duration : null;
    const position = Math.round(last.position + (last.paused ? 0 : this.deps.now() - last.at));
    return { positionMs: duration === null ? position : Math.min(position, duration), durationMs: duration, paused: last.paused, ready: true };
  }

  isAudible(): boolean {
    return this.state === 'online' && this.last !== null && !this.last.paused;
  }

  whenSilent(timeoutMs: number): Promise<boolean> {
    if (!this.isAudible()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (): void => {
        this.deps.timers.clearTimeout(timer);
        resolve(true);
      };
      const timer = this.deps.timers.setTimeout(() => {
        this.silentWaiters = this.silentWaiters.filter((waiter) => waiter !== done);
        resolve(!this.isAudible());
      }, timeoutMs);
      this.silentWaiters.push(done);
    });
  }

  async recheck(fromGesture: boolean): Promise<boolean> {
    if (fromGesture && !this.isOnline()) return this.connect();
    await this.refresh();
    return this.isOnline();
  }

  subscribe(listener: (event: AdapterEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.unwatch();
    this.resetAttempt();
    this.player?.disconnect();
    this.player = null;
    this.listeners.clear();
  }

  private isOnline(): boolean {
    return this.state === 'online' && this.deviceId !== null;
  }

  private activate(player: SdkPlayer): void {
    // iOS／Safari 需要在點擊的同步路徑內啟用音訊元素。
    void player.activateElement().catch(() => undefined);
  }

  private provideToken(callback: (token: string) => void): void {
    this.deps.remote.token().then(
      (token) => callback(token.accessToken),
      () => this.report('offline', 'auth'),
    );
  }

  private attach(player: SdkPlayer): SdkPlayer {
    player.addListener('ready', (payload) => this.onReady(payload));
    player.addListener('not_ready', () => this.onNotReady());
    player.addListener('player_state_changed', (payload) => this.onState(payload as SdkPlaybackState | null));
    player.addListener('autoplay_failed', () => {
      if (this.current && !this.current.confirmed) this.fail(this.current.attemptId, 'AUTOPLAY_BLOCKED');
    });
    player.addListener('initialization_error', () => this.report('offline', 'sdk'));
    player.addListener('authentication_error', () => this.report('offline', 'auth'));
    player.addListener('account_error', () => this.report('offline', 'account'));
    player.addListener('playback_error', () => {
      if (this.current && !this.current.confirmed) this.fail(this.current.attemptId, 'AUDIO_SOURCE_FAILED');
    });
    this.player = player;
    return player;
  }

  private async reconnect(player: SdkPlayer): Promise<boolean> {
    if (this.isOnline()) return true;
    if (this.connected) player.disconnect();
    this.deviceId = null;
    this.report('connecting', null);
    const ok = await player.connect().catch(() => false);
    this.connected = ok;
    if (!ok) {
      this.report('offline', 'sdk');
      return false;
    }
    return this.isOnline() ? true : this.waitReady();
  }

  private waitReady(): Promise<boolean> {
    return new Promise((resolve) => {
      const done = (ok: boolean): void => {
        this.deps.timers.clearTimeout(timer);
        resolve(ok);
      };
      const timer = this.deps.timers.setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((waiter) => waiter !== done);
        if (!this.isOnline()) this.report('offline', 'not_found');
        resolve(this.isOnline());
      }, READY_TIMEOUT_MS);
      this.readyWaiters.push(done);
    });
  }

  private onReady(payload: unknown): void {
    const id = deviceIdOf(payload);
    if (!id) return;
    this.deviceId = id;
    this.report('online', null);
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const waiter of waiters) waiter(true);
  }

  private onNotReady(): void {
    this.deviceId = null;
    this.report('offline', 'not_found');
    this.flushSilent();
    if (this.current) {
      this.resetAttempt();
      this.emit({ type: 'device_lost' });
    }
  }

  private onState(sdk: SdkPlaybackState | null): void {
    if (!sdk) {
      this.last = null;
      this.flushSilent();
      return;
    }
    const uri = sdk.track_window.current_track?.uri ?? null;
    this.last = { paused: sdk.paused, position: sdk.position, duration: sdk.duration, at: this.deps.now(), uri };
    if (sdk.paused) this.flushSilent();
    const current = this.current;
    if (!current) return;
    if (!current.confirmed) {
      this.maybeConfirm(current, sdk, uri);
      return;
    }
    if (this.finished(current, sdk, uri)) {
      this.current = null;
      this.emit({ type: 'ended', attemptId: current.attemptId, owner: 'track' });
      return;
    }
    if (sdk.paused && !this.localPause) this.emit({ type: 'paused', attemptId: current.attemptId, owner: 'track', positionMs: sdk.position });
  }

  private maybeConfirm(current: Attempt, sdk: SdkPlaybackState, uri: string | null): void {
    if (sdk.paused) return;
    const matches = uri === current.uri || (current.playingUri !== null && uri === current.playingUri) || (current.fresh && uri !== null && uri !== current.beforeUri);
    if (!matches) return;
    this.clearConfirm();
    this.current = { ...current, confirmed: true, playingUri: uri ?? current.uri };
    this.pausedAt = null;
    this.emit({ type: 'started', attemptId: current.attemptId, owner: 'track' });
  }

  /** 播完：曲目被推進「上一首」，或停在 0（不是我們自己按的暫停）。 */
  private finished(current: Attempt, sdk: SdkPlaybackState, uri: string | null): boolean {
    const playing = current.playingUri ?? current.uri;
    const inPrevious = sdk.track_window.previous_tracks.some((track) => track.uri === playing);
    if (uri !== playing && inPrevious) return true;
    return sdk.paused && sdk.position === 0 && !this.localPause && (uri === playing || inPrevious);
  }

  private async play(request: StartRequest, uri: string): Promise<void> {
    const deviceId = this.deviceId;
    if (!deviceId) throw deviceUnavailable();
    const attempt: Attempt = { attemptId: request.attemptId, uri, fresh: true, beforeUri: this.last?.uri ?? null, confirmed: false, playingUri: null };
    this.current = attempt;
    try {
      await this.deps.remote.play({ deviceId, uri, positionMs: request.fromMs });
    } catch (error: unknown) {
      if (this.current === attempt) this.current = null;
      const reason = remoteReason(error);
      if (reason === 'other') throw error;
      if (reason === 'not_found') this.deviceId = null;
      this.report('offline', reason);
      throw deviceUnavailable();
    }
    if (this.current === attempt) this.armConfirm(attempt.attemptId);
  }

  /** 送出後一直沒確認在播：當成需要使用者點一下，同時暫停，避免晚到的聲音和「點一下繼續」同時出現。 */
  private armConfirm(attemptId: number): void {
    this.clearConfirm();
    this.confirmTimer = this.deps.timers.setTimeout(() => {
      this.confirmTimer = null;
      if (this.current?.attemptId !== attemptId || this.current.confirmed) return;
      this.fail(attemptId, 'AUTOPLAY_BLOCKED');
      void this.player?.pause().catch(() => undefined);
    }, CONFIRM_TIMEOUT_MS);
  }

  private clearConfirm(): void {
    if (this.confirmTimer === null) return;
    this.deps.timers.clearTimeout(this.confirmTimer);
    this.confirmTimer = null;
  }

  private resetAttempt(): void {
    this.clearConfirm();
    this.current = null;
    this.localPause = false;
    this.pausedAt = null;
  }

  private fail(attemptId: number, code: 'AUTOPLAY_BLOCKED' | 'AUDIO_SOURCE_FAILED'): void {
    this.clearConfirm();
    this.current = null;
    this.emit({ type: 'failed', attemptId, owner: 'track', code });
  }

  private async refresh(): Promise<void> {
    const player = this.player;
    if (!player) return;
    const sdk = await player.getCurrentState().catch(() => undefined);
    if (sdk !== undefined) this.onState(sdk);
  }

  private flushSilent(): void {
    const waiters = this.silentWaiters;
    this.silentWaiters = [];
    for (const waiter of waiters) waiter();
  }

  private report(state: DeviceState, reason: DeviceReason): void {
    this.state = state;
    this.deps.report?.({ path: 'P', state, deviceName: PLAYER_NAME, reason });
  }

  private emit(event: AdapterEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
