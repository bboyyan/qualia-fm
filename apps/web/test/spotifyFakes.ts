import type { Segment, SpotifyDevice, SpotifyPlayback, SpotifyPlayRequest } from '@qualia/contracts';
import type { SdkPlaybackState, SdkPlayer, SdkPlayerOptions, SpotifySdk } from '../src/audio/spotify/sdk';
import type { SpotifyRemote, Timers, Visibility } from '../src/audio/spotify/types';
import type { AdapterEvent, MediaAdapter, ProviderState, StartRequest } from '../src/audio/types';
import { localError } from '../src/api/client';
import { segment } from './fixtures';

/** 以手動推進的假時鐘取代 setTimeout，讓逾時與輪詢可預測。 */
export class FakeClock implements Timers {
  now = 1_000_000;
  private seq = 0;
  private tasks: { id: number; at: number; fn: () => void }[] = [];
  readonly setTimeout = (fn: () => void, ms: number): number => {
    this.seq += 1;
    this.tasks.push({ id: this.seq, at: this.now + ms, fn });
    return this.seq;
  };
  readonly clearTimeout = (handle: unknown): void => {
    this.tasks = this.tasks.filter((task) => task.id !== handle);
  };
  get pending(): number {
    return this.tasks.length;
  }
  async advance(ms: number): Promise<void> {
    const target = this.now + ms;
    for (;;) {
      const due = this.tasks.filter((task) => task.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.tasks = this.tasks.filter((task) => task !== due);
      this.now = due.at;
      due.fn();
      await flush();
    }
    this.now = target;
    await flush();
  }
}

export const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

export class FakeVisibility implements Visibility {
  visible = true;
  private readonly listeners = new Set<(visible: boolean) => void>();
  isVisible = (): boolean => this.visible;
  onChange = (listener: (visible: boolean) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  set(visible: boolean): void {
    this.visible = visible;
    for (const listener of this.listeners) listener(visible);
  }
}

type Listener = (payload: unknown) => void;

/** 假的 Spotify.Player：只記錄呼叫，事件由測試手動觸發。 */
export class FakePlayer implements SdkPlayer {
  readonly calls: string[] = [];
  private readonly listeners = new Map<string, Listener[]>();
  connectResult = true;
  current: SdkPlaybackState | null = null;
  constructor(readonly options: SdkPlayerOptions) {}
  connect(): Promise<boolean> {
    this.calls.push('connect');
    return Promise.resolve(this.connectResult);
  }
  disconnect(): void {
    this.calls.push('disconnect');
  }
  activateElement(): Promise<void> {
    this.calls.push('activateElement');
    return Promise.resolve();
  }
  addListener(event: string, listener: Listener): boolean {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return true;
  }
  removeListener(event: string): boolean {
    this.listeners.delete(event);
    return true;
  }
  getCurrentState(): Promise<SdkPlaybackState | null> {
    this.calls.push('getCurrentState');
    return Promise.resolve(this.current);
  }
  pause(): Promise<void> {
    this.calls.push('pause');
    return Promise.resolve();
  }
  resume(): Promise<void> {
    this.calls.push('resume');
    return Promise.resolve();
  }
  seek(ms: number): Promise<void> {
    this.calls.push(`seek:${ms}`);
    return Promise.resolve();
  }
  emit(event: string, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }
  ready(deviceId = 'TESTdeviceP'): void {
    this.emit('ready', { device_id: deviceId });
  }
  /** loading＝SDK 已收到 play、還在載入（此時常回報 paused，但不代表之後不會出聲）。 */
  state(uri: string | null, paused: boolean, position = 0, previous: string[] = [], loading?: boolean): void {
    this.current = {
      paused,
      ...(loading === undefined ? {} : { loading }),
      position,
      duration: 200_000,
      track_window: { current_track: uri ? { uri } : null, previous_tracks: previous.map((u) => ({ uri: u })) },
    };
    this.emit('player_state_changed', this.current);
  }
}

export class FakeSdk implements SpotifySdk {
  loads = 0;
  readonly players: FakePlayer[] = [];
  createPlayer(options: SdkPlayerOptions): SdkPlayer {
    const player = new FakePlayer(options);
    this.players.push(player);
    return player;
  }
  get player(): FakePlayer {
    const player = this.players.at(-1);
    if (!player) throw new Error('player not created');
    return player;
  }
  readonly load = (): Promise<SpotifySdk> => {
    this.loads += 1;
    return Promise.resolve(this);
  };
}

/** 假的伺服器播放代理：記錄 play／pause，可預設下一次失敗。 */
export class FakeRemote implements SpotifyRemote {
  readonly plays: SpotifyPlayRequest[] = [];
  readonly pauses: string[] = [];
  devicesList: SpotifyDevice[] = [{ id: 'TESTphone', name: 'TEST iPhone', type: 'Smartphone', isActive: true }];
  playbackState: SpotifyPlayback = { deviceId: null, isPlaying: false, uri: null, progressMs: 0, durationMs: null };
  playbackCalls = 0;
  devicesCalls = 0;
  failNextPlay: 'DEVICE_UNAVAILABLE' | 'SPOTIFY_ACCOUNT_ERROR' | null = null;
  token = () => Promise.resolve({ accessToken: 'TEST-access', expiresAt: '2026-10-05T01:00:00.000Z' });
  devices = (): Promise<SpotifyDevice[]> => {
    this.devicesCalls += 1;
    return Promise.resolve(this.devicesList);
  };
  playback = (): Promise<SpotifyPlayback> => {
    this.playbackCalls += 1;
    return Promise.resolve(this.playbackState);
  };
  /** 設為 true 時 play 不會自己完成，要由測試呼叫 landPlay()／failPlay() 模擬「指令還在路上」。 */
  deferPlays = false;
  private readonly pending: { resolve: () => void; reject: (error: unknown) => void }[] = [];
  get pendingPlays(): number {
    return this.pending.length;
  }
  /** 讓最早送出、還在路上的 play 生效（伺服器回 204）。 */
  landPlay(): void {
    this.pending.shift()?.resolve();
  }
  play = (request: SpotifyPlayRequest): Promise<void> => {
    this.plays.push(request);
    if (this.deferPlays) return new Promise<void>((resolve, reject) => this.pending.push({ resolve, reject }));
    if (this.failNextPlay) {
      const code = this.failNextPlay;
      this.failNextPlay = null;
      return Promise.reject(localError(code));
    }
    return Promise.resolve();
  };
  pause = (deviceId: string): Promise<void> => {
    this.pauses.push(deviceId);
    return Promise.resolve();
  };
}

export const TEST_URI = 'spotify:track:TESTtrack0000000000001';
export const OTHER_URI = 'spotify:track:TESTtrack0000000000002';

/** 已對應到 Spotify 的段落（顯示用封面為假網址）。 */
export function spotifySegment(n = 1, uri = TEST_URI): Segment {
  const base = segment('showS', n);
  return {
    ...base,
    track: {
      ...base.track,
      provider: 'spotify',
      providerTrackId: uri.split(':')[2] ?? null,
      artworkUrl: 'https://i.scdn.co/image/TEST',
      externalUrl: 'https://open.spotify.com/track/TEST',
      audioLocator: { kind: 'spotify_uri', uri },
    },
  };
}

/** 只記錄出聲狀態；stop 可設成「非同步才真的停」。 */
export class SlowBase implements MediaAdapter {
  playing = false;
  stopDelayMs = 0;
  starts: string[] = [];
  private listener: ((event: AdapterEvent) => void) | null = null;
  constructor(private readonly clock: FakeClock) {}
  start(request: StartRequest): Promise<void> {
    this.starts.push(request.owner);
    this.playing = true;
    return Promise.resolve();
  }
  pause(): void { this.playing = false; }
  resume(): Promise<void> { return Promise.resolve(); }
  seek(): void {}
  stop(): void {
    if (this.stopDelayMs === 0) this.playing = false;
    else if (Number.isFinite(this.stopDelayMs)) this.clock.setTimeout(() => (this.playing = false), this.stopDelayMs);
  }
  getState(): ProviderState | null { return { positionMs: 0, durationMs: null, paused: !this.playing, ready: true }; }
  subscribe(listener: (event: AdapterEvent) => void): () => void { this.listener = listener; return () => (this.listener = null); }
  destroy(): void {}
  emit(event: AdapterEvent): void { this.listener?.(event); }
}
