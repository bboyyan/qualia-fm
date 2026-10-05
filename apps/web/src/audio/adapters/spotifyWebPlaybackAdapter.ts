/**
 * 路徑 P：Qualia 網頁自己當 Spotify Connect 裝置（Web Playback SDK）。
 * - SDK 只在使用者點擊（connect）時載入；有播放器時 activateElement 同步留在手勢內。
 * - 每首前就緒檢查：不在且不在手勢內 → NotAllowedError（點一下繼續）；手勢內 → 重新接上，仍不行 → 裝置離線。
 * - 送出 play（伺服器代理、帶 device_id）後，要等 player_state_changed 確認真的在播才回報 started。
 * - 不疊音（Policy III.7）：每次切段都換「世代」。play 在路上時被 stop／暫停，生效後一律暫停；
 *   我方不要聲音時 SDK 若回報在播，一律再暫停；在路上或待確認靜音期間都算「可能出聲」。
 * - SDK 會先回報「載入中／已暫停」、約 80ms 後才真的出聲（BRA-111）：待確認靜音時，那一首的「已暫停」
 *   要不是載入中、且穩定 SILENCE_SETTLE_MS 沒有再出聲才算安靜；stop 時已生效但還沒確認在播的那首也照此等待。
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
/** 遲到的 play 被暫停後，等 SDK 回報已暫停的時間；逾時重讀一次狀態。 */
const SILENCE_RECHECK_MS = 1500;
/** 「已暫停」要穩定這麼久才算安靜（涵蓋 SDK 先報已暫停、約 80ms 後才出聲）。 */
const SILENCE_SETTLE_MS = 500;

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
  /** 每次 start／stop 加一；play 回來時世代不同＝已被切段。 */
  private generation = 0;
  /** 已送出、伺服器還沒回應的 play 數。 */
  private inflight = 0;
  /** 遲到的 play 已被暫停，但 SDK 還沒回報「那一首」已暫停。 */
  private pendingSilence = false;
  /** 待確認靜音的那一首；只有它回報 paused 才算安靜（play 生效前的舊 paused 不算）。 */
  private silenceUri: string | null = null;
  private silenceTimer: unknown = null;
  /** 待確認靜音的那首開始回報「已暫停（非載入中）」的時間；之後再出聲就重來。 */
  private quietSince: number | null = null;
  /** 介紹播放期間的守候：SDK 在我方不要聲音時回報在播就通知（一次）。 */
  private onLeak: (() => void) | null = null;
  /** 被切掉的曲目；它遲到的「播放中」狀態不能當成新一首的確認。 */
  private readonly staleUris = new Set<string>();
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
    this.supersede();
    this.clearPendingSilence();
    const generation = this.generation;
    if (this.isOnline()) return this.play(request, locator.uri, generation);
    if (!gesture) return Promise.reject(gestureNeeded());
    return this.connect().then((ok) => {
      if (generation !== this.generation) return;
      return ok ? this.play(request, locator.uri, generation) : Promise.reject(deviceUnavailable());
    });
  }

  pause(): void {
    this.localPause = true;
    this.pausedAt = this.deps.now();
    this.clearConfirm();
    this.silencePlayer();
  }

  resume(attemptId: number): Promise<void> {
    const current = this.current;
    if (!current) return Promise.reject(deviceUnavailable());
    if (this.pausedAt !== null && this.deps.now() - this.pausedAt > PAUSE_RECONNECT_MS) {
      this.supersede();
      this.report('offline', 'paused_too_long');
      return Promise.reject(deviceUnavailable());
    }
    if (!this.isOnline()) return Promise.reject(this.deps.hasUserGesture() ? deviceUnavailable() : gestureNeeded());
    this.current = { ...current, attemptId, confirmed: false, fresh: false };
    this.localPause = false;
    this.pausedAt = null;
    this.clearPendingSilence();
    // play 還在路上：等它生效即可（生效時 localPause 已解除）；否則請 SDK 繼續。
    if (this.inflight === 0) void this.player?.resume().catch(() => undefined);
    this.armConfirm(attemptId);
    return Promise.resolve();
  }

  seek(positionMs: number): void {
    void this.player?.seek(positionMs).catch(() => undefined);
  }

  /** 切段／回饋／換模式：一律請 SDK 暫停（即使 play 還在路上或尚未確認），世代換新。 */
  stop(): void {
    const active = this.current !== null || this.isAudible();
    // play 已生效、但 SDK 還沒確認在播（可能正在載入）：它隨時會出聲，要等那一首穩定靜音。
    const landed = this.current !== null && !this.current.confirmed && this.inflight === 0 ? this.current.uri : null;
    this.supersede();
    this.localPause = true;
    if (landed) this.silenceLatePlay(landed);
    else if (active) this.silencePlayer();
  }

  getState(): ProviderState | null {
    if (!this.isOnline()) return null;
    const last = this.last;
    if (!last) return { positionMs: 0, durationMs: null, paused: true, ready: true };
    const duration = last.duration > 0 ? last.duration : null;
    const position = Math.round(last.position + (last.paused ? 0 : this.deps.now() - last.at));
    return { positionMs: duration === null ? position : Math.min(position, duration), durationMs: duration, paused: last.paused, ready: true };
  }

  /** 「可能出聲」：play 在路上、遲到的 play 尚未確認暫停，或 SDK 回報正在播。 */
  isAudible(): boolean {
    return this.inflight > 0 || this.pendingSilence || (this.state === 'online' && this.last !== null && !this.last.paused);
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

  holdSilence(onLeak: () => void): () => void {
    this.onLeak = onLeak;
    return () => {
      if (this.onLeak === onLeak) this.onLeak = null;
    };
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
    this.supersede();
    this.clearSilenceTimer();
    this.onLeak = null;
    this.player?.disconnect();
    this.player = null;
    this.listeners.clear();
  }

  private isOnline(): boolean {
    return this.state === 'online' && this.deviceId !== null;
  }

  /** 我方此刻不要聲音：沒有進行中的一首，或使用者按了暫停。 */
  private wantsSilence(): boolean {
    return this.current === null || this.localPause;
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
    this.clearPendingSilence();
    this.report('offline', 'not_found');
    const hadAttempt = this.current !== null;
    if (hadAttempt) this.supersede();
    this.checkSilent();
    if (hadAttempt) this.emit({ type: 'device_lost' });
  }

  private onState(sdk: SdkPlaybackState | null): void {
    if (!sdk) {
      // null＝這個播放器目前不是作用中裝置；不足以證明遲到的 play 不會再生效，所以不清待確認靜音。
      this.last = null;
      this.checkSilent();
      return;
    }
    const uri = sdk.track_window.current_track?.uri ?? null;
    this.last = { paused: sdk.paused, position: sdk.position, duration: sdk.duration, at: this.deps.now(), uri };
    if (sdk.paused && sdk.loading !== true) {
      if (this.pendingSilence && uri === this.silenceUri) this.settleSilence();
    } else if (this.pendingSilence) {
      // 載入中或又出聲：重新計算穩定時間，並在一段時間後重讀狀態。
      this.quietSince = null;
      this.armSilenceRecheck();
    }
    if (!sdk.paused && this.wantsSilence()) {
      // 遲到生效的 play 或我方已要求暫停：不論誰讓它出聲，一律再暫停（不疊音）。
      this.silencePlayer();
      this.leak();
      return;
    }
    this.checkSilent();
    const current = this.current;
    if (!current) return;
    if (!current.confirmed) {
      this.maybeConfirm(current, sdk, uri);
      return;
    }
    if (this.finished(current, sdk, uri)) {
      this.current = null;
      this.generation += 1;
      this.emit({ type: 'ended', attemptId: current.attemptId, owner: 'track' });
      return;
    }
    if (sdk.paused && !this.localPause) this.emit({ type: 'paused', attemptId: current.attemptId, owner: 'track', positionMs: sdk.position });
  }

  private maybeConfirm(current: Attempt, sdk: SdkPlaybackState, uri: string | null): void {
    if (sdk.paused || uri === null) return;
    const matches = uri === current.uri || uri === current.playingUri || (current.fresh && uri !== current.beforeUri && !this.staleUris.has(uri));
    if (!matches) return;
    this.clearConfirm();
    this.current = { ...current, confirmed: true, playingUri: uri };
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

  private async play(request: StartRequest, uri: string, generation: number): Promise<void> {
    const deviceId = this.deviceId;
    if (!deviceId) throw deviceUnavailable();
    this.staleUris.delete(uri);
    const attempt: Attempt = { attemptId: request.attemptId, uri, fresh: true, beforeUri: this.last?.uri ?? null, confirmed: false, playingUri: null };
    this.current = attempt;
    this.inflight += 1;
    try {
      await this.deps.remote.play({ deviceId, uri, positionMs: request.fromMs });
    } catch (error: unknown) {
      this.inflight -= 1;
      if (this.current === attempt) this.current = null;
      this.checkSilent();
      const reason = remoteReason(error);
      if (reason === 'other') throw error;
      if (reason === 'not_found') this.deviceId = null;
      this.report('offline', reason);
      throw deviceUnavailable();
    }
    this.inflight -= 1;
    // 以請求代號（世代）判斷是否被切段；不能比對 current 物件——SDK 先回報在播時 maybeConfirm 會換掉它（B2）。
    if (generation !== this.generation) {
      // 在路上時被切段：這個 play 剛生效，立刻暫停，並等 SDK 確認「這一首」已暫停才算安靜。
      this.staleUris.add(uri);
      this.silenceLatePlay(uri);
      return;
    }
    if (this.localPause) {
      // 在路上時使用者按了暫停：保留這一首（可以繼續），但現在就暫停。
      this.silenceLatePlay(uri);
      return;
    }
    if (this.current?.confirmed) return;
    this.armConfirm(attempt.attemptId);
  }

  private clearPendingSilence(): void {
    this.pendingSilence = false;
    this.silenceUri = null;
    this.quietSince = null;
    this.clearSilenceTimer();
  }

  private silenceLatePlay(uri: string): void {
    this.pendingSilence = true;
    this.silenceUri = uri;
    this.quietSince = null;
    this.silencePlayer();
    this.armSilenceRecheck();
  }

  /** 一直沒有新狀態時，過一段時間主動重讀一次。 */
  private armSilenceRecheck(): void {
    this.clearSilenceTimer();
    this.silenceTimer = this.deps.timers.setTimeout(() => {
      this.silenceTimer = null;
      void this.refresh();
    }, SILENCE_RECHECK_MS);
  }

  /** 那一首回報已暫停（非載入中）：穩定 SILENCE_SETTLE_MS 都沒再出聲才算安靜（不靠下一個 SDK 事件）。 */
  private settleSilence(): void {
    const now = this.deps.now();
    this.quietSince ??= now;
    const waited = now - this.quietSince;
    if (waited >= SILENCE_SETTLE_MS) {
      this.clearPendingSilence();
      return;
    }
    this.clearSilenceTimer();
    this.silenceTimer = this.deps.timers.setTimeout(() => {
      this.silenceTimer = null;
      if (!this.pendingSilence || this.quietSince === null) return;
      this.settleSilence();
      this.checkSilent();
    }, SILENCE_SETTLE_MS - waited);
  }

  /** 介紹守候中 SDK 出聲（已再暫停）：通知 router 停介紹（只一次）。 */
  private leak(): void {
    const onLeak = this.onLeak;
    this.onLeak = null;
    onLeak?.();
  }

  private silencePlayer(): void {
    void this.player?.pause().catch(() => undefined);
  }

  /** 送出後一直沒確認在播：當成需要使用者點一下，同時暫停，避免晚到的聲音和「點一下繼續」同時出現。 */
  private armConfirm(attemptId: number): void {
    this.clearConfirm();
    this.confirmTimer = this.deps.timers.setTimeout(() => {
      this.confirmTimer = null;
      if (this.current?.attemptId !== attemptId || this.current.confirmed) return;
      this.fail(attemptId, 'AUTOPLAY_BLOCKED');
      this.silencePlayer();
    }, CONFIRM_TIMEOUT_MS);
  }

  private clearConfirm(): void {
    if (this.confirmTimer === null) return;
    this.deps.timers.clearTimeout(this.confirmTimer);
    this.confirmTimer = null;
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer === null) return;
    this.deps.timers.clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  /** 換世代：目前這一首（含還在路上的）作廢。 */
  private supersede(): void {
    this.generation += 1;
    this.clearConfirm();
    if (this.current && !this.current.confirmed) this.staleUris.add(this.current.uri);
    this.current = null;
    this.localPause = false;
    this.pausedAt = null;
  }

  private fail(attemptId: number, code: 'AUTOPLAY_BLOCKED' | 'AUDIO_SOURCE_FAILED'): void {
    this.clearConfirm();
    this.current = null;
    // 這一首作廢：若它的 play 之後才回應，視同被切段而暫停。
    this.generation += 1;
    this.emit({ type: 'failed', attemptId, owner: 'track', code });
  }

  private async refresh(): Promise<void> {
    const player = this.player;
    if (!player) return;
    const sdk = await player.getCurrentState().catch(() => undefined);
    if (sdk !== undefined) this.onState(sdk);
  }

  private checkSilent(): void {
    if (this.isAudible()) return;
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
