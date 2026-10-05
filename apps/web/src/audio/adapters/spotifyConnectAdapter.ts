/**
 * 路徑 C（備援）：用 Web API 遙控使用者手機上的 Spotify app。指令一律帶 device_id（由伺服器代理）。
 * - 每首前就緒檢查（裝置清單裡要有這台）；不在就停下，不盲送 play。
 * - 以狀態查詢確認真的在播才回報 started；只在頁面可見時輪詢，暫停時不輪詢。
 * - 暫停超過約 10 分鐘視為需重連（官方 Connect 說明）。
 * - 不疊音（Policy III.7）：每次切段換「世代」；stop 只要有進行中的一首就送 pause（即使還沒確認在播）。
 *   play 在路上時被切段或暫停，生效後再送一次 pause，並以狀態查詢確認靜音；在路上或待確認期間都算「可能出聲」。
 * - 介紹播放期間（holdSilence）低頻輪詢：裝置可能在 play 回應約 2 秒後才出聲（BRA-111），出聲就再暫停並通知 router 停介紹。
 *   守候最多 GUARD_MAX_MS（介紹被暫停或等點擊時不無限輪詢）；殘餘疊音上限約一次輪詢間隔＋pause 生效時間（BRA-114 真機量測）。
 */
import type { SpotifyPlayback } from '@qualia/contracts';
import {
  PAUSE_RECONNECT_MS,
  deviceUnavailable,
  gestureNeeded,
  reachedEnd,
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

const POLL_MS = 2000;
const SILENCE_POLL_MS = 500;
/** 連續這麼久查到「沒在播」才算安靜（裝置可能在 pause 之後才開始播）。 */
const SILENCE_SETTLE_MS = 1500;
/** 確認靜音的輪詢上限；逾時仍沒確認就停止輪詢、維持「可能出聲」（介紹不會開始）。 */
const SILENCE_WATCH_MAX_MS = 30_000;
const CONFIRM_TIMEOUT_MS = 12_000;
/** 介紹期間的守候輪詢間隔（低頻，與播放中輪詢相同，避免 429）。 */
const GUARD_POLL_MS = 2000;
/** 守候總時長上限（從 holdSilence 起算）：最多約 30 次查詢；晚出聲多發生在 play 生效後數秒內。 */
const GUARD_MAX_MS = 60_000;

export interface ConnectDeps {
  readonly remote: SpotifyRemote;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly timers: Timers;
  readonly now: () => number;
  readonly hasUserGesture: () => boolean;
  readonly visibility: Visibility;
  readonly report?: (status: SpotifyDeviceStatus) => void;
}

interface Attempt {
  readonly attemptId: number;
  readonly uri: string;
  readonly confirmed: boolean;
  readonly deadline: number;
}

interface Snapshot extends SpotifyPlayback {
  readonly at: number;
}

export class SpotifyConnectAdapter implements SpotifyOutput {
  readonly path = 'C' as const;
  private readonly listeners = new Set<(event: AdapterEvent) => void>();
  private state: DeviceState = 'online';
  private current: Attempt | null = null;
  private last: Snapshot | null = null;
  private pollTimer: unknown = null;
  private pausedAt: number | null = null;
  private localPause = false;
  /** 本次播放曾在同裝置、同曲目的正位置播放；中途回報 playing/0 不清掉。 */
  private playedAtPositivePosition = false;
  /** 每次 start／stop 加一；play 回來時世代不同＝已被切段。 */
  private generation = 0;
  /** 已送出、伺服器還沒回應的 play 數。 */
  private inflight = 0;
  /** 已送 pause（切段或遲到的 play），但還沒以查詢確認 Spotify 穩定停下。 */
  private pendingSilence = false;
  private silenceTimer: unknown = null;
  private quietSince: number | null = null;
  private watchStartedAt = 0;
  private silentWaiters: (() => void)[] = [];
  /** 介紹播放期間的守候：Spotify 出聲時通知（一次）。 */
  private onLeak: (() => void) | null = null;
  private guardTimer: unknown = null;
  /** 守候截止時間；過了就不再查（直到下一次 holdSilence）。 */
  private guardUntil = 0;
  private readonly unwatch: () => void;

  constructor(private readonly deps: ConnectDeps) {
    this.unwatch = deps.visibility.onChange((visible) => {
      if (!visible) {
        this.clearPoll();
        this.clearSilenceTimer();
        this.clearGuard();
      } else if (this.pendingSilence) void this.checkSilence();
      else if (this.current && !this.localPause) void this.poll();
      else if (this.onLeak) void this.guard();
    });
  }

  start(request: StartRequest): Promise<void> {
    const locator = request.segment.track.audioLocator;
    if (request.owner !== 'track' || locator.kind !== 'spotify_uri') return Promise.reject(notSupported('Spotify app 只播放 Spotify 曲目。'));
    const gesture = this.deps.hasUserGesture();
    this.supersede();
    this.endSilenceWatch();
    const generation = this.generation;
    return this.ensureDevice(gesture).then(() => {
      if (generation !== this.generation) return;
      return this.play(request.attemptId, locator.uri, request.fromMs, generation);
    });
  }

  pause(): void {
    this.localPause = true;
    this.playedAtPositivePosition = false;
    this.pausedAt = this.deps.now();
    this.clearPoll();
    this.sendPause();
  }

  resume(attemptId: number): Promise<void> {
    const current = this.current;
    if (!current) return Promise.reject(deviceUnavailable());
    if (this.pausedAt !== null && this.deps.now() - this.pausedAt > PAUSE_RECONNECT_MS) {
      this.supersede();
      this.report('offline', 'paused_too_long');
      return Promise.reject(deviceUnavailable());
    }
    const gesture = this.deps.hasUserGesture();
    const position = this.last?.progressMs ?? 0;
    this.localPause = false;
    this.pausedAt = null;
    this.endSilenceWatch();
    const generation = this.generation;
    return this.ensureDevice(gesture).then(() => {
      if (generation !== this.generation || this.localPause) return;
      return this.play(attemptId, current.uri, position, generation);
    });
  }

  seek(positionMs: number): void {
    const current = this.current;
    if (!current) return;
    void this.deps.remote.play({ deviceId: this.deps.deviceId, uri: current.uri, positionMs: Math.max(0, Math.round(positionMs)) }).catch(() => undefined);
  }

  /** 切段／回饋／換模式：只要有進行中的一首（含還在路上、尚未確認）或可能出聲，就送 pause。 */
  stop(): void {
    const active = this.current !== null || this.isAudible();
    this.supersede();
    this.localPause = true;
    if (!active) return;
    this.sendPause();
    this.beginSilenceWatch();
  }

  getState(): ProviderState | null {
    if (this.state !== 'online') return null;
    const last = this.last;
    if (!last) return { positionMs: 0, durationMs: null, paused: true, ready: true };
    const position = last.progressMs + (last.isPlaying ? this.deps.now() - last.at : 0);
    return { positionMs: last.durationMs === null ? position : Math.min(position, last.durationMs), durationMs: last.durationMs, paused: !last.isPlaying, ready: true };
  }

  /** 「可能出聲」：play 在路上、遲到的 play 尚未確認停止，或最近一次查詢顯示這台正在播。 */
  isAudible(): boolean {
    return this.inflight > 0 || this.pendingSilence || (this.state === 'online' && this.last !== null && this.last.isPlaying && this.last.deviceId === this.deps.deviceId);
  }

  /** 等主動輪詢確認靜音（在路上的 play 也要等它生效、被暫停且穩定停下）；逾時回 false，交由呼叫端不疊音。 */
  whenSilent(timeoutMs: number): Promise<boolean> {
    if (!this.isAudible()) return Promise.resolve(true);
    if (!this.pendingSilence) this.beginSilenceWatch();
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
    this.guardUntil = this.deps.now() + GUARD_MAX_MS;
    // 正在確認靜音時由 checkSilence 負責；確認結束後才改用低頻守候。
    if (!this.pendingSilence) this.scheduleGuard();
    return () => {
      if (this.onLeak !== onLeak) return;
      this.onLeak = null;
      this.clearGuard();
    };
  }

  async recheck(): Promise<boolean> {
    const present = await this.isPresent();
    if (present) this.report('online', null);
    else if (this.state !== 'offline') this.report('offline', 'not_found');
    return present;
  }

  subscribe(listener: (event: AdapterEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.unwatch();
    this.supersede();
    this.endSilenceWatch();
    this.onLeak = null;
    this.clearGuard();
    this.listeners.clear();
  }

  private async isPresent(): Promise<boolean> {
    try {
      return (await this.deps.remote.devices()).some((device) => device.id === this.deps.deviceId);
    } catch (error: unknown) {
      const reason = remoteReason(error);
      if (reason !== 'other') this.report('offline', reason);
      return false;
    }
  }

  /** 就緒檢查：裝置不在就停下；手勢內代表使用者已經點過「點一下繼續」，改走三段提示。 */
  private async ensureDevice(gesture: boolean): Promise<void> {
    if (await this.isPresent()) {
      this.report('online', null);
      return;
    }
    if (this.state !== 'offline') this.report('offline', 'not_found');
    throw gesture ? deviceUnavailable() : gestureNeeded();
  }

  private async play(attemptId: number, uri: string, positionMs: number, generation: number): Promise<void> {
    const attempt: Attempt = { attemptId, uri, confirmed: false, deadline: this.deps.now() + CONFIRM_TIMEOUT_MS };
    this.playedAtPositivePosition = false;
    this.current = attempt;
    this.inflight += 1;
    try {
      await this.deps.remote.play({ deviceId: this.deps.deviceId, uri, positionMs: Math.max(0, Math.round(positionMs)) });
    } catch (error: unknown) {
      this.inflight -= 1;
      if (this.current === attempt) this.current = null;
      this.checkSilent();
      const reason = remoteReason(error);
      if (reason === 'other') throw error;
      this.report('offline', reason);
      throw deviceUnavailable();
    }
    this.inflight -= 1;
    // 以請求代號（世代）判斷是否被切段；不能比對 current 物件——輪詢先確認在播時會換掉它（B2）。
    if (generation !== this.generation || this.localPause) {
      // 在路上時被切段或按了暫停：play 剛生效，再送一次 pause，並主動輪詢確認穩定停下。
      this.sendPause();
      this.beginSilenceWatch();
      return;
    }
    this.schedulePoll();
  }

  /** 我方此刻不要聲音：沒有進行中的一首，或使用者按了暫停。 */
  private wantsSilence(): boolean {
    return this.current === null || this.localPause;
  }

  private beginSilenceWatch(): void {
    this.pendingSilence = true;
    this.quietSince = null;
    this.watchStartedAt = this.deps.now();
    if (this.silenceTimer === null) this.scheduleSilenceCheck();
  }

  private endSilenceWatch(): void {
    this.pendingSilence = false;
    this.quietSince = null;
    this.clearSilenceTimer();
  }

  private scheduleSilenceCheck(): void {
    this.clearSilenceTimer();
    if (!this.deps.visibility.isVisible()) return;
    this.silenceTimer = this.deps.timers.setTimeout(() => {
      this.silenceTimer = null;
      void this.checkSilence();
    }, SILENCE_POLL_MS);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer === null) return;
    this.deps.timers.clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  /** 主動確認靜音：這台還在播就再送 pause；連續 SILENCE_SETTLE_MS 都沒在播才算安靜。只在頁面可見時輪詢。 */
  private async checkSilence(): Promise<void> {
    this.clearSilenceTimer();
    if (!this.pendingSilence) return this.checkSilent();
    if (this.inflight > 0) return this.scheduleSilenceCheck();
    const playback = await this.deps.remote.playback().catch(() => null);
    if (!this.pendingSilence) return this.checkSilent();
    const now = this.deps.now();
    if (playback) {
      this.last = { ...playback, at: now };
      if (playback.isPlaying && playback.deviceId === this.deps.deviceId) {
        if (this.wantsSilence()) this.leak();
        this.quietSince = null;
      } else {
        this.quietSince ??= now;
        if (now - this.quietSince >= SILENCE_SETTLE_MS) {
          this.endSilenceWatch();
          this.checkSilent();
          this.scheduleGuard();
          return;
        }
      }
    }
    if (now - this.watchStartedAt > SILENCE_WATCH_MAX_MS) return;
    this.scheduleSilenceCheck();
  }

  /** 我方不要聲音時這台在播：再暫停；介紹守候中就通知（只一次）。 */
  private leak(): void {
    this.sendPause();
    const onLeak = this.onLeak;
    this.onLeak = null;
    this.clearGuard();
    onLeak?.();
  }

  private scheduleGuard(): void {
    this.clearGuard();
    // 上限由 guard() 判斷（到期時不查詢並解除），這裡不重複檢查。
    if (!this.onLeak || this.pendingSilence || !this.deps.visibility.isVisible()) return;
    this.guardTimer = this.deps.timers.setTimeout(() => {
      this.guardTimer = null;
      void this.guard();
    }, GUARD_POLL_MS);
  }

  private clearGuard(): void {
    if (this.guardTimer === null) return;
    this.deps.timers.clearTimeout(this.guardTimer);
    this.guardTimer = null;
  }

  /** 介紹期間低頻確認：這台在播且我方不要聲音 → 再暫停、通知停介紹，並回到主動確認靜音。 */
  /** 守候已到上限：解除，之後回前景也不再查。 */
  private guardExpired(): boolean {
    if (this.deps.now() < this.guardUntil) return false;
    this.onLeak = null;
    return true;
  }

  private async guard(): Promise<void> {
    this.clearGuard();
    if (!this.onLeak || this.pendingSilence || this.guardExpired()) return;
    const playback = await this.deps.remote.playback().catch(() => null);
    if (!this.onLeak || this.pendingSilence) return;
    if (playback) this.last = { ...playback, at: this.deps.now() };
    if (playback?.isPlaying && playback.deviceId === this.deps.deviceId && this.wantsSilence()) {
      this.leak();
      this.beginSilenceWatch();
      return;
    }
    this.scheduleGuard();
  }

  private checkSilent(): void {
    if (this.isAudible()) return;
    const waiters = this.silentWaiters;
    this.silentWaiters = [];
    for (const waiter of waiters) waiter();
  }

  private sendPause(): void {
    void this.deps.remote.pause(this.deps.deviceId).catch(() => undefined);
  }

  private schedulePoll(): void {
    this.clearPoll();
    if (!this.current || this.localPause || !this.deps.visibility.isVisible()) return;
    this.pollTimer = this.deps.timers.setTimeout(() => {
      this.pollTimer = null;
      void this.poll();
    }, POLL_MS);
  }

  private clearPoll(): void {
    if (this.pollTimer === null) return;
    this.deps.timers.clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private async poll(): Promise<void> {
    this.clearPoll();
    const current = this.current;
    if (!current || this.localPause) return;
    const playback = await this.deps.remote.playback().catch(() => null);
    if (this.localPause) return;
    if (playback && this.current === current) this.onPlayback(current, playback);
    this.schedulePoll();
  }

  private onPlayback(current: Attempt, playback: SpotifyPlayback): void {
    const before = this.last;
    const durationMs = before?.durationMs ?? playback.durationMs;
    const nearEnd = before !== null && reachedEnd(before.progressMs + (before.isPlaying ? this.deps.now() - before.at : 0), durationMs);
    if (playback.isPlaying && playback.progressMs > 0 && playback.uri === current.uri && playback.deviceId === this.deps.deviceId) {
      this.playedAtPositivePosition = true;
    }
    const playedWithoutDuration = durationMs === null && this.playedAtPositivePosition;
    this.last = { ...playback, at: this.deps.now() };
    if (!current.confirmed) {
      if (playback.isPlaying && playback.uri === current.uri && playback.deviceId === this.deps.deviceId) {
        this.current = { ...current, confirmed: true };
        this.emit({ type: 'started', attemptId: current.attemptId, owner: 'track' });
      } else if (this.deps.now() >= current.deadline) {
        this.current = null;
        // 這一首作廢：若它的 play 之後才回應，視同被切段而暫停。
        this.generation += 1;
        this.emit({ type: 'failed', attemptId: current.attemptId, owner: 'track', code: 'AUTOPLAY_BLOCKED' });
        this.sendPause();
      }
      return;
    }
    if (playback.deviceId === null) {
      this.current = null;
      this.report('offline', 'not_found');
      this.emit({ type: 'device_lost' });
      return;
    }
    // 已知時長仍須接近尾端；時長缺失時，以同曲目曾在正位置播放、之後停止歸零判定完播（BRA-117 P2）。
    if (!this.localPause && (playback.uri !== current.uri || (!playback.isPlaying && playback.progressMs === 0 && (nearEnd || playedWithoutDuration)))) {
      this.current = null;
      this.emit({ type: 'ended', attemptId: current.attemptId, owner: 'track' });
      return;
    }
    if (!playback.isPlaying && !this.localPause) {
      this.localPause = true;
      this.emit({ type: 'paused', attemptId: current.attemptId, owner: 'track', positionMs: playback.progressMs });
    }
  }

  /** 換世代：目前這一首（含還在路上的）作廢。 */
  private supersede(): void {
    this.generation += 1;
    this.clearPoll();
    this.current = null;
    this.localPause = false;
    this.playedAtPositivePosition = false;
    this.pausedAt = null;
  }

  private report(state: DeviceState, reason: DeviceReason): void {
    this.state = state;
    this.deps.report?.({ path: 'C', state, deviceName: this.deps.deviceName, reason });
  }

  private emit(event: AdapterEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
