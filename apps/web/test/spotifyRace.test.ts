import { describe, expect, it } from 'vitest';
import { PlaybackRouter } from '../src/audio/adapters/playbackRouter';
import { SpotifyConnectAdapter } from '../src/audio/adapters/spotifyConnectAdapter';
import { SpotifyWebPlaybackAdapter } from '../src/audio/adapters/spotifyWebPlaybackAdapter';
import type { SpotifyOutput } from '../src/audio/spotify/types';
import type { AdapterEvent, MediaAdapter, ProviderState, StartRequest } from '../src/audio/types';
import { FakeClock, FakeRemote, FakeSdk, FakeVisibility, OTHER_URI, TEST_URI, flush, spotifySegment } from './spotifyFakes';

/**
 * B1（Policy III.7）競態：Spotify play 還在路上時切段（下一首／JUMP／暫停）。
 * 遲到生效的 play 必須被暫停，而且介紹要等 Spotify 確認靜音才開始，任何時刻都不能兩邊同時出聲。
 */

const track = (attemptId: number) => ({ owner: 'track' as const, segment: spotifySegment(), attemptId, fromMs: 0 });
const speech = (attemptId: number) => ({ owner: 'speech' as const, segment: spotifySegment(), attemptId, fromMs: 0 });
const pauses = (calls: readonly string[]): number => calls.filter((call) => call === 'pause').length;

function webPlayer() {
  const sdk = new FakeSdk();
  const remote = new FakeRemote();
  remote.deferPlays = true;
  const clock = new FakeClock();
  const adapter = new SpotifyWebPlaybackAdapter({ loadSdk: sdk.load, remote, timers: clock, now: () => clock.now, hasUserGesture: () => false, visibility: new FakeVisibility() });
  const events: AdapterEvent[] = [];
  adapter.subscribe((event) => events.push(event));
  const online = async () => {
    const connecting = adapter.connect();
    await flush();
    sdk.player.ready();
    await connecting;
  };
  return { sdk, remote, clock, adapter, events, online };
}

function connectApp() {
  const remote = new FakeRemote();
  remote.deferPlays = true;
  const clock = new FakeClock();
  const adapter = new SpotifyConnectAdapter({ remote, deviceId: 'TESTphone', deviceName: 'TEST iPhone', timers: clock, now: () => clock.now, hasUserGesture: () => false, visibility: new FakeVisibility() });
  const events: AdapterEvent[] = [];
  adapter.subscribe((event) => events.push(event));
  return { remote, clock, adapter, events };
}

describe('路徑 P：play 在路上時切段', () => {
  it('stop 後 play 才生效 → 立刻暫停；遲到的「播放中」狀態也再被暫停；不回報 started', async () => {
    const ctx = webPlayer();
    await ctx.online();
    void ctx.adapter.start(track(1)).catch(() => undefined);
    await flush();
    ctx.adapter.stop();
    expect(ctx.adapter.isAudible()).toBe(true);
    const before = pauses(ctx.sdk.player.calls);
    ctx.remote.landPlay();
    await flush();
    expect(pauses(ctx.sdk.player.calls)).toBe(before + 1);
    ctx.sdk.player.state(TEST_URI, false, 100);
    expect(pauses(ctx.sdk.player.calls)).toBe(before + 2);
    expect(ctx.adapter.isAudible()).toBe(true);
    ctx.sdk.player.state(TEST_URI, true, 120);
    expect(ctx.adapter.isAudible()).toBe(false);
    expect(ctx.events.filter((e) => e.type === 'started')).toEqual([]);
  });

  it('play 在路上時按暫停：生效後立刻暫停，不回報 started；之後繼續才播放', async () => {
    const ctx = webPlayer();
    await ctx.online();
    void ctx.adapter.start(track(2)).catch(() => undefined);
    await flush();
    ctx.adapter.pause();
    const before = pauses(ctx.sdk.player.calls);
    ctx.remote.landPlay();
    await flush();
    expect(pauses(ctx.sdk.player.calls)).toBe(before + 1);
    ctx.sdk.player.state(TEST_URI, false, 50);
    expect(pauses(ctx.sdk.player.calls)).toBe(before + 2);
    expect(ctx.events.filter((e) => e.type === 'started')).toEqual([]);
    ctx.sdk.player.state(TEST_URI, true, 60);
    await ctx.adapter.resume(2);
    ctx.sdk.player.state(TEST_URI, false, 70);
    expect(ctx.events).toEqual([{ type: 'started', attemptId: 2, owner: 'track' }]);
  });

  it('whenSilent 要等在路上的 play 生效、被暫停、且 SDK 回報已暫停', async () => {
    const ctx = webPlayer();
    await ctx.online();
    void ctx.adapter.start(track(3)).catch(() => undefined);
    await flush();
    ctx.adapter.stop();
    let silent: boolean | null = null;
    void ctx.adapter.whenSilent(2500).then((value) => (silent = value));
    await flush();
    expect(silent).toBeNull();
    ctx.remote.landPlay();
    await flush();
    expect(silent).toBeNull();
    ctx.sdk.player.state(TEST_URI, true, 10);
    await flush();
    expect(silent).toBe(true);
  });
});

describe('路徑 C：play 在路上時切段', () => {
  it('stop 立刻送 pause（即使還沒確認在播），play 生效後再送一次並輪詢確認靜音', async () => {
    const ctx = connectApp();
    void ctx.adapter.start(track(1)).catch(() => undefined);
    await flush();
    expect(ctx.remote.pendingPlays).toBe(1);
    ctx.adapter.stop();
    expect(ctx.remote.pauses).toEqual(['TESTphone']);
    ctx.remote.landPlay();
    await flush();
    expect(ctx.remote.pauses).toEqual(['TESTphone', 'TESTphone']);
    expect(ctx.adapter.isAudible()).toBe(true);
    let silent: boolean | null = null;
    void ctx.adapter.whenSilent(5000).then((value) => (silent = value));
    await ctx.clock.advance(500);
    expect(ctx.remote.playbackCalls).toBeGreaterThan(0);
    expect(silent).toBeNull();
    await ctx.clock.advance(2000);
    expect(silent).toBe(true);
    expect(ctx.events.filter((e) => e.type === 'started')).toEqual([]);
  });

  it('play 在路上時按暫停：生效後再送 pause，不開始輪詢、不回報 started', async () => {
    const ctx = connectApp();
    void ctx.adapter.start(track(2)).catch(() => undefined);
    await flush();
    ctx.adapter.pause();
    ctx.remote.landPlay();
    await flush();
    expect(ctx.remote.pauses).toEqual(['TESTphone', 'TESTphone']);
    await ctx.clock.advance(10_000);
    expect(ctx.events.filter((e) => e.type === 'started')).toEqual([]);
  });
});

/** 只記錄出聲狀態；stop 可設成「非同步才真的停」。 */
class SlowBase implements MediaAdapter {
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

describe('Router：任何時刻只有一個來源出聲', () => {
  it('下一首在 Spotify play 途中：介紹等 Spotify 確認靜音才開始（整合 P 路徑）', async () => {
    const ctx = webPlayer();
    await ctx.online();
    const base = new SlowBase(ctx.clock);
    const router = new PlaybackRouter(base, ctx.clock);
    router.setSpotifyOutput(ctx.adapter);
    void router.start(track(1)).catch(() => undefined);
    await flush();
    void router.start(speech(2)).catch(() => undefined);
    await flush();
    expect(base.starts).toEqual([]);
    ctx.remote.landPlay();
    await flush();
    ctx.sdk.player.state(TEST_URI, false, 30);
    await flush();
    expect(base.starts).toEqual([]);
    ctx.sdk.player.state(TEST_URI, true, 40);
    await flush();
    expect(base.starts).toEqual(['speech']);
    expect(ctx.sdk.player.current?.paused).toBe(true);
  });

  it('介紹播放中若 Spotify 輸出回報 started（遲到）：停掉 Spotify，事件不轉給引擎', async () => {
    const clock = new FakeClock();
    const base = new SlowBase(clock);
    const router = new PlaybackRouter(base, clock);
    const stops: number[] = [];
    const listeners: ((event: AdapterEvent) => void)[] = [];
    const output: SpotifyOutput = {
      path: 'P', isAudible: () => false, whenSilent: () => Promise.resolve(true), recheck: () => Promise.resolve(true),
      start: () => Promise.resolve(), pause: () => undefined, resume: () => Promise.resolve(), seek: () => undefined,
      stop: () => { stops.push(1); }, getState: () => null, destroy: () => undefined,
      subscribe: (listener) => { listeners.push(listener); return () => undefined; },
    };
    router.setSpotifyOutput(output);
    const events: AdapterEvent[] = [];
    router.subscribe((event) => events.push(event));
    await router.start(speech(1));
    for (const listener of listeners) listener({ type: 'started', attemptId: 1, owner: 'track' });
    expect(stops).toHaveLength(1);
    expect(events).toEqual([]);
  });

  it('<audio> 的 stop 是非同步時，要等它真的停了才送 Spotify（M6 守衛）', async () => {
    const ctx = webPlayer();
    await ctx.online();
    const base = new SlowBase(ctx.clock);
    const router = new PlaybackRouter(base, ctx.clock);
    router.setSpotifyOutput(ctx.adapter);
    await router.start(speech(1));
    base.stopDelayMs = 120;
    void router.start(track(2)).catch(() => undefined);
    await flush();
    expect(ctx.remote.plays).toEqual([]);
    await ctx.clock.advance(200);
    expect(base.playing).toBe(false);
    expect(ctx.remote.plays).toHaveLength(1);
  });

  it('<audio> 一直停不下來 → 不送 Spotify，回報這首無法開始', async () => {
    const ctx = webPlayer();
    await ctx.online();
    const base = new SlowBase(ctx.clock);
    const router = new PlaybackRouter(base, ctx.clock);
    router.setSpotifyOutput(ctx.adapter);
    await router.start(speech(1));
    base.stopDelayMs = Number.POSITIVE_INFINITY;
    let error: unknown = null;
    void router.start(track(2)).catch((e: unknown) => (error = e));
    await ctx.clock.advance(5000);
    expect((error as DOMException | null)?.name).toBe('NotSupportedError');
    expect(ctx.remote.plays).toEqual([]);
  });
});

describe('Router：等待靜音期間被切段', () => {
  it('介紹還在等 Spotify 靜音時又被 stop：Spotify 靜音後也不再開始那段介紹', async () => {
    const ctx = webPlayer();
    await ctx.online();
    const base = new SlowBase(ctx.clock);
    const router = new PlaybackRouter(base, ctx.clock);
    router.setSpotifyOutput(ctx.adapter);
    void router.start(track(1)).catch(() => undefined);
    await flush();
    let error: unknown = null;
    void router.start(speech(2)).catch((e: unknown) => (error = e));
    await flush();
    router.stop();
    ctx.remote.landPlay();
    await flush();
    ctx.sdk.player.state(TEST_URI, true, 10);
    await flush();
    expect(base.starts).toEqual([]);
    expect((error as DOMException | null)?.name).toBe('AbortError');
  });
});


/** 第二輪複審（B1'／B2／合併前必修／N3c／N8）：更貼近實際時序的情境。 */
function connectWith(visibility = new FakeVisibility()) {
  const remote = new FakeRemote();
  remote.deferPlays = true;
  const clock = new FakeClock();
  const adapter = new SpotifyConnectAdapter({ remote, deviceId: 'TESTphone', deviceName: 'TEST iPhone', timers: clock, now: () => clock.now, hasUserGesture: () => false, visibility });
  const events: AdapterEvent[] = [];
  adapter.subscribe((event) => events.push(event));
  return { remote, clock, adapter, events, visibility };
}

const playingOn = (uri: string, progressMs = 100) => ({ deviceId: 'TESTphone', isPlaying: true, uri, progressMs, durationMs: 200_000 });
const quiet = { deviceId: 'TESTphone', isPlaying: false, uri: TEST_URI, progressMs: 100, durationMs: 200_000 };

describe("B1'：play 在路上時連按兩次「下一首」", () => {
  it('路徑 P：第二次下一首也要等 Spotify 確認靜音，介紹只開始一次', async () => {
    const ctx = webPlayer();
    await ctx.online();
    const base = new SlowBase(ctx.clock);
    const router = new PlaybackRouter(base, ctx.clock);
    router.setSpotifyOutput(ctx.adapter);
    void router.start(track(1)).catch(() => undefined);
    await flush();
    void router.start(speech(2)).catch(() => undefined);
    await flush();
    void router.start(speech(3)).catch(() => undefined);
    await flush();
    expect(base.starts).toEqual([]);
    ctx.remote.landPlay();
    await flush();
    ctx.sdk.player.state(TEST_URI, false, 30);
    await flush();
    expect(base.starts).toEqual([]);
    ctx.sdk.player.state(TEST_URI, true, 40);
    await flush();
    expect(base.starts).toEqual(['speech']);
  });

  it('路徑 C：第二次下一首也要等；play 生效後主動輪詢確認靜音才開始介紹', async () => {
    const ctx = connectWith();
    const base = new SlowBase(ctx.clock);
    const router = new PlaybackRouter(base, ctx.clock);
    router.setSpotifyOutput(ctx.adapter);
    void router.start(track(1)).catch(() => undefined);
    await flush();
    expect(ctx.remote.pendingPlays).toBe(1);
    void router.start(speech(2)).catch(() => undefined);
    await flush();
    void router.start(speech(3)).catch(() => undefined);
    await flush();
    expect(base.starts).toEqual([]);
    ctx.remote.playbackState = playingOn(TEST_URI);
    ctx.remote.landPlay();
    await flush();
    await ctx.clock.advance(1000);
    expect(base.starts).toEqual([]);
    ctx.remote.playbackState = quiet;
    await ctx.clock.advance(4000);
    expect(base.starts).toEqual(['speech']);
  });

  it('路徑 C：遲到 pause 送出後裝置才開始播（晚於 2.5 秒）→ 仍會被發現並再暫停，不會一直疊', async () => {
    const ctx = connectWith();
    void ctx.adapter.start(track(1)).catch(() => undefined);
    await flush();
    ctx.adapter.stop();
    ctx.remote.playbackState = quiet;
    ctx.remote.landPlay();
    await flush();
    const pausesAfterLand = ctx.remote.pauses.length;
    await ctx.clock.advance(1000);
    ctx.remote.playbackState = playingOn(TEST_URI);
    await ctx.clock.advance(2500);
    expect(ctx.remote.pauses.length).toBeGreaterThan(pausesAfterLand);
    expect(ctx.adapter.isAudible()).toBe(true);
  });
});

describe('B2：狀態先到、play 回應後到（沒有切段）', () => {
  it('路徑 P：SDK 先回報在播 → started；play 回應後到不可以把這首暫停', async () => {
    const ctx = webPlayer();
    await ctx.online();
    void ctx.adapter.start(track(1)).catch(() => undefined);
    await flush();
    ctx.sdk.player.state(TEST_URI, false, 10);
    expect(ctx.events).toEqual([{ type: 'started', attemptId: 1, owner: 'track' }]);
    const before = pauses(ctx.sdk.player.calls);
    ctx.remote.landPlay();
    await flush();
    expect(pauses(ctx.sdk.player.calls)).toBe(before);
    await ctx.clock.advance(15_000);
    expect(pauses(ctx.sdk.player.calls)).toBe(before);
    expect(ctx.events).toEqual([{ type: 'started', attemptId: 1, owner: 'track' }]);
  });

  it('路徑 C：play 途中回前景、輪詢先確認在播 → play 回應後到不可以送 pause', async () => {
    const ctx = connectWith();
    void ctx.adapter.start(track(1)).catch(() => undefined);
    await flush();
    ctx.remote.playbackState = playingOn(TEST_URI);
    ctx.visibility.set(false);
    ctx.visibility.set(true);
    await flush();
    expect(ctx.events).toEqual([{ type: 'started', attemptId: 1, owner: 'track' }]);
    ctx.remote.landPlay();
    await flush();
    expect(ctx.remote.pauses).toEqual([]);
  });
});

describe('合併前必修：P 的待確認靜音只接受遲到那首的「已暫停」', () => {
  it('play 生效前的舊 paused（舊曲目或 null）不算數；遲到那首回報已暫停才算安靜', async () => {
    const ctx = webPlayer();
    await ctx.online();
    void ctx.adapter.start(track(1)).catch(() => undefined);
    await flush();
    ctx.adapter.stop();
    ctx.remote.landPlay();
    await flush();
    let silent: boolean | null = null;
    void ctx.adapter.whenSilent(2500).then((value) => (silent = value));
    ctx.sdk.player.state(OTHER_URI, true, 0);
    ctx.sdk.player.state(null, true, 0);
    await flush();
    expect(ctx.adapter.isAudible()).toBe(true);
    expect(silent).toBeNull();
    ctx.sdk.player.state(TEST_URI, true, 5);
    await flush();
    expect(silent).toBe(true);
  });
});

describe('存活變異補測', () => {
  it('N3c：等 <audio> 停止的 1 秒內又被切段 → 之後就算 <audio> 停了也不送 Spotify', async () => {
    const ctx = webPlayer();
    await ctx.online();
    const base = new SlowBase(ctx.clock);
    const router = new PlaybackRouter(base, ctx.clock);
    router.setSpotifyOutput(ctx.adapter);
    await router.start(speech(1));
    base.stopDelayMs = 120;
    let error: unknown = null;
    void router.start(track(2)).catch((e: unknown) => (error = e));
    await flush();
    router.stop();
    await ctx.clock.advance(500);
    expect(base.playing).toBe(false);
    expect(ctx.remote.plays).toEqual([]);
    expect((error as DOMException | null)?.name).toBe('AbortError');
  });

  it('N8：被切掉那首遲到的「播放中」不能被當成新一首的確認', async () => {
    const ctx = webPlayer();
    await ctx.online();
    void ctx.adapter.start(track(1)).catch(() => undefined);
    await flush();
    ctx.adapter.stop();
    ctx.remote.landPlay();
    await flush();
    void ctx.adapter.start({ owner: 'track', segment: spotifySegment(2, OTHER_URI), attemptId: 2, fromMs: 0 }).catch(() => undefined);
    await flush();
    ctx.sdk.player.state(TEST_URI, false, 50);
    expect(ctx.events.filter((e) => e.type === 'started')).toEqual([]);
    ctx.remote.landPlay();
    await flush();
    ctx.sdk.player.state(OTHER_URI, false, 10);
    expect(ctx.events).toEqual([{ type: 'started', attemptId: 2, owner: 'track' }]);
  });
});
