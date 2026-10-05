/**
 * 路徑 C（備援）：用 Web API 遙控使用者手機上的 Spotify app。指令一律帶 device_id（由伺服器代理）。
 * - 每首前就緒檢查（裝置清單裡要有這台）；不在就停下，不盲送 play。
 * - 以狀態查詢確認真的在播才回報 started；只在頁面可見時輪詢，暫停時不輪詢。
 * - 暫停超過約 10 分鐘視為需重連（官方 Connect 說明）。
 */
import type { SpotifyPlayback } from '@qualia/contracts';
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

const POLL_MS = 2000;
const SILENCE_POLL_MS = 500;
const CONFIRM_TIMEOUT_MS = 12_000;

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
  private readonly unwatch: () => void;

  constructor(private readonly deps: ConnectDeps) {
    this.unwatch = deps.visibility.onChange((visible) => {
      if (!visible) this.clearPoll();
      else if (this.current && !this.localPause) void this.poll();
    });
  }

  start(request: StartRequest): Promise<void> {
    const locator = request.segment.track.audioLocator;
    if (request.owner !== 'track' || locator.kind !== 'spotify_uri') return Promise.reject(notSupported('Spotify app 只播放 Spotify 曲目。'));
    const gesture = this.deps.hasUserGesture();
    this.resetAttempt();
    return this.ensureDevice(gesture).then(() => this.play(request.attemptId, locator.uri, request.fromMs));
  }

  pause(): void {
    this.localPause = true;
    this.pausedAt = this.deps.now();
    this.clearPoll();
    void this.deps.remote.pause(this.deps.deviceId).catch(() => undefined);
  }

  resume(attemptId: number): Promise<void> {
    const current = this.current;
    if (!current) return Promise.reject(deviceUnavailable());
    if (this.pausedAt !== null && this.deps.now() - this.pausedAt > PAUSE_RECONNECT_MS) {
      this.current = null;
      this.report('offline', 'paused_too_long');
      return Promise.reject(deviceUnavailable());
    }
    const gesture = this.deps.hasUserGesture();
    const position = this.last?.progressMs ?? 0;
    this.localPause = false;
    this.pausedAt = null;
    return this.ensureDevice(gesture).then(() => this.play(attemptId, current.uri, position));
  }

  seek(positionMs: number): void {
    const current = this.current;
    if (!current) return;
    void this.deps.remote.play({ deviceId: this.deps.deviceId, uri: current.uri, positionMs: Math.max(0, Math.round(positionMs)) }).catch(() => undefined);
  }

  stop(): void {
    const audible = this.isAudible();
    this.resetAttempt();
    this.localPause = true;
    if (audible) void this.deps.remote.pause(this.deps.deviceId).catch(() => undefined);
  }

  getState(): ProviderState | null {
    if (this.state !== 'online') return null;
    const last = this.last;
    if (!last) return { positionMs: 0, durationMs: null, paused: true, ready: true };
    const position = last.progressMs + (last.isPlaying ? this.deps.now() - last.at : 0);
    return { positionMs: last.durationMs === null ? position : Math.min(position, last.durationMs), durationMs: last.durationMs, paused: !last.isPlaying, ready: true };
  }

  isAudible(): boolean {
    return this.state === 'online' && this.last !== null && this.last.isPlaying && this.last.deviceId === this.deps.deviceId;
  }

  /** 送出暫停後以狀態查詢確認靜音（逾時回 false，交由呼叫端不疊音）。 */
  async whenSilent(timeoutMs: number): Promise<boolean> {
    const deadline = this.deps.now() + timeoutMs;
    while (this.isAudible()) {
      if (this.deps.now() >= deadline) return false;
      await new Promise<void>((resolve) => this.deps.timers.setTimeout(resolve, SILENCE_POLL_MS));
      const playback = await this.deps.remote.playback().catch(() => null);
      if (playback) this.last = { ...playback, at: this.deps.now() };
    }
    return true;
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
    this.resetAttempt();
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

  private async play(attemptId: number, uri: string, positionMs: number): Promise<void> {
    const attempt: Attempt = { attemptId, uri, confirmed: false, deadline: this.deps.now() + CONFIRM_TIMEOUT_MS };
    this.current = attempt;
    try {
      await this.deps.remote.play({ deviceId: this.deps.deviceId, uri, positionMs: Math.max(0, Math.round(positionMs)) });
    } catch (error: unknown) {
      if (this.current === attempt) this.current = null;
      const reason = remoteReason(error);
      if (reason === 'other') throw error;
      this.report('offline', reason);
      throw deviceUnavailable();
    }
    if (this.current === attempt) this.schedulePoll();
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
    if (playback && this.current === current) this.onPlayback(current, playback);
    this.schedulePoll();
  }

  private onPlayback(current: Attempt, playback: SpotifyPlayback): void {
    this.last = { ...playback, at: this.deps.now() };
    if (!current.confirmed) {
      if (playback.isPlaying && playback.uri === current.uri && playback.deviceId === this.deps.deviceId) {
        this.current = { ...current, confirmed: true };
        this.emit({ type: 'started', attemptId: current.attemptId, owner: 'track' });
      } else if (this.deps.now() >= current.deadline) {
        this.current = null;
        this.emit({ type: 'failed', attemptId: current.attemptId, owner: 'track', code: 'AUTOPLAY_BLOCKED' });
        void this.deps.remote.pause(this.deps.deviceId).catch(() => undefined);
      }
      return;
    }
    if (playback.deviceId === null) {
      this.current = null;
      this.report('offline', 'not_found');
      this.emit({ type: 'device_lost' });
      return;
    }
    if (playback.uri !== current.uri || (!playback.isPlaying && playback.progressMs === 0)) {
      this.current = null;
      this.emit({ type: 'ended', attemptId: current.attemptId, owner: 'track' });
      return;
    }
    if (!playback.isPlaying && !this.localPause) {
      this.localPause = true;
      this.emit({ type: 'paused', attemptId: current.attemptId, owner: 'track', positionMs: playback.progressMs });
    }
  }

  private resetAttempt(): void {
    this.clearPoll();
    this.current = null;
    this.localPause = false;
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
