import { describe, expect, it } from 'vitest';
import { PlaybackRouter } from '../src/audio/adapters/playbackRouter';
import { SpotifyConnectAdapter } from '../src/audio/adapters/spotifyConnectAdapter';
import { SpotifyWebPlaybackAdapter } from '../src/audio/adapters/spotifyWebPlaybackAdapter';
import type { AdapterEvent } from '../src/audio/types';
import { FakeClock, FakeRemote, FakeSdk, FakeVisibility, SlowBase, TEST_URI, flush, spotifySegment } from './spotifyFakes';

/**
 * BRA-111 啟用前事項：兩種實測／推演出的短暫疊音（Policy III.7）。
 * - 路徑 C：play 回應後超過約 1.9 秒裝置才出聲，靜音確認已結束、介紹已開始 → 疊音。
 *   修法：介紹播放期間低頻持續檢查，Spotify 出聲就停介紹（並再暫停 Spotify）。
 * - 路徑 P（假設情境，非 SDK 實測）：SDK 先回報「載入中／已暫停」，80ms（模擬值）後才真的出聲 → 介紹與歌曲短暫重疊。
 *   修法：已暫停要穩定一段時間（且不是載入中）才算安靜；stop 時已生效但未確認的那首也要等穩定靜音。
 */

const track = (attemptId: number) => ({ owner: 'track' as const, segment: spotifySegment(), attemptId, fromMs: 0 });
const speech = (attemptId: number) => ({ owner: 'speech' as const, segment: spotifySegment(), attemptId, fromMs: 0 });
const pauses = (calls: readonly string[]): number => calls.filter((call) => call === 'pause').length;
const playingOn = (uri: string, progressMs = 100) => ({ deviceId: 'TESTphone', isPlaying: true, uri, progressMs, durationMs: 200_000 });
const quiet = { deviceId: 'TESTphone', isPlaying: false, uri: TEST_URI, progressMs: 100, durationMs: 200_000 };

function webRouter() {
  const sdk = new FakeSdk();
  const remote = new FakeRemote();
  remote.deferPlays = true;
  const clock = new FakeClock();
  const adapter = new SpotifyWebPlaybackAdapter({ loadSdk: sdk.load, remote, timers: clock, now: () => clock.now, hasUserGesture: () => false, visibility: new FakeVisibility() });
  const base = new SlowBase(clock);
  const router = new PlaybackRouter(base, clock);
  router.setSpotifyOutput(adapter);
  const events: AdapterEvent[] = [];
  router.subscribe((event) => events.push(event));
  const online = async () => {
    const connecting = adapter.connect();
    await flush();
    sdk.player.ready();
    await connecting;
  };
  /** 介紹（<audio>）與 SDK 同時出聲＝疊音。 */
  const overlapping = (): boolean => base.playing && sdk.player.current !== null && !sdk.player.current.paused;
  return { sdk, remote, clock, adapter, base, router, events, online, overlapping };
}

function connectRouter(visibility = new FakeVisibility()) {
  const remote = new FakeRemote();
  remote.deferPlays = true;
  const clock = new FakeClock();
  const adapter = new SpotifyConnectAdapter({ remote, deviceId: 'TESTphone', deviceName: 'TEST iPhone', timers: clock, now: () => clock.now, hasUserGesture: () => false, visibility });
  const base = new SlowBase(clock);
  const router = new PlaybackRouter(base, clock);
  router.setSpotifyOutput(adapter);
  const events: AdapterEvent[] = [];
  router.subscribe((event) => events.push(event));
  return { remote, clock, adapter, base, router, events, visibility };
}

/** 路徑 C：play 生效、靜音確認結束（約 2 秒）後介紹開始。 */
async function introAfterSlowLanding(ctx: ReturnType<typeof connectRouter>): Promise<void> {
  void ctx.router.start(track(1)).catch(() => undefined);
  await flush();
  void ctx.router.start(speech(2)).catch(() => undefined);
  ctx.remote.playbackState = quiet;
  ctx.remote.landPlay();
  await flush();
  await ctx.clock.advance(2500);
}

describe('路徑 C：play 回應後超過約 1.9 秒才出聲', () => {
  it('介紹期間低頻檢查：裝置晚出聲 → 停介紹、再暫停 Spotify，並把介紹回報為失敗（引擎改顯示文字、直接進歌）', async () => {
    const ctx = connectRouter();
    await introAfterSlowLanding(ctx);
    expect(ctx.base.starts).toEqual(['speech']);
    expect(ctx.base.playing).toBe(true);
    const pausesBefore = ctx.remote.pauses.length;
    ctx.remote.playbackState = playingOn(TEST_URI);
    await ctx.clock.advance(2000);
    expect(ctx.base.playing).toBe(false);
    expect(ctx.remote.pauses.length).toBeGreaterThan(pausesBefore);
    expect(ctx.events).toEqual([{ type: 'failed', attemptId: 2, owner: 'speech', code: 'AUDIO_SOURCE_FAILED' }]);
    // 出聲後回到主動確認靜音：再次查到安靜且穩定後才算安靜。
    expect(ctx.adapter.isAudible()).toBe(true);
    ctx.remote.playbackState = quiet;
    await ctx.clock.advance(2500);
    expect(ctx.adapter.isAudible()).toBe(false);
  });

  it('介紹期間 Spotify 一直安靜：檢查是低頻（間隔 2 秒），不停介紹、不送 pause', async () => {
    const ctx = connectRouter();
    const checkedAt: number[] = [];
    const playback = ctx.remote.playback;
    ctx.remote.playback = () => (checkedAt.push(ctx.clock.now), playback());
    await introAfterSlowLanding(ctx);
    const introAt = checkedAt.length;
    const pausesBefore = ctx.remote.pauses.length;
    await ctx.clock.advance(10_000);
    const guardChecks = checkedAt.slice(introAt - 1);
    expect(guardChecks.length).toBeGreaterThanOrEqual(5);
    expect(guardChecks.slice(1).map((at, i) => at - guardChecks[i]!)).toEqual(Array(guardChecks.length - 1).fill(2000));
    expect(ctx.base.playing).toBe(true);
    expect(ctx.remote.pauses.length).toBe(pausesBefore);
    expect(ctx.events).toEqual([]);
  });

  it('介紹結束（切段／stop）後停止檢查', async () => {
    const ctx = connectRouter();
    await introAfterSlowLanding(ctx);
    ctx.router.stop();
    const callsBefore = ctx.remote.playbackCalls;
    await ctx.clock.advance(10_000);
    expect(ctx.remote.playbackCalls).toBe(callsBefore);
  });

  it('頁面在背景時不輪詢；回到前景立刻檢查，出聲就停介紹', async () => {
    const ctx = connectRouter();
    await introAfterSlowLanding(ctx);
    ctx.visibility.set(false);
    const callsBefore = ctx.remote.playbackCalls;
    await ctx.clock.advance(10_000);
    expect(ctx.remote.playbackCalls).toBe(callsBefore);
    ctx.remote.playbackState = playingOn(TEST_URI);
    ctx.visibility.set(true);
    await flush();
    expect(ctx.remote.playbackCalls).toBe(callsBefore + 1);
    expect(ctx.base.playing).toBe(false);
    expect(ctx.events.map((e) => e.type)).toEqual(['failed']);
  });

  it('介紹已暫停（使用者按暫停）時 Spotify 晚出聲：只暫停 Spotify，不把介紹當失敗', async () => {
    const ctx = connectRouter();
    await introAfterSlowLanding(ctx);
    ctx.router.pause();
    const pausesBefore = ctx.remote.pauses.length;
    ctx.remote.playbackState = playingOn(TEST_URI);
    await ctx.clock.advance(2000);
    expect(ctx.remote.pauses.length).toBeGreaterThan(pausesBefore);
    expect(ctx.events).toEqual([]);
  });

  it('MOCK 測試音（<audio> 的曲目）播放中不做介紹用的檢查', async () => {
    const ctx = connectRouter();
    const mockTrack = { owner: 'track' as const, segment: { ...spotifySegment(), track: { ...spotifySegment().track, audioLocator: { kind: 'none' as const } } }, attemptId: 1, fromMs: 0 };
    await ctx.router.start(mockTrack);
    await ctx.clock.advance(10_000);
    expect(ctx.remote.playbackCalls).toBe(0);
  });
});

describe('路徑 P（模擬假設）：SDK 先回報載入中／已暫停，80ms 後才出聲', () => {
  it('play 已生效、SDK 只回報已暫停時切段 → 介紹不立刻開始；80ms 後出聲被暫停；穩定靜音後才開始，全程不疊', async () => {
    const ctx = webRouter();
    await ctx.online();
    void ctx.router.start(track(1)).catch(() => undefined);
    await flush();
    ctx.remote.landPlay();
    await flush();
    ctx.sdk.player.state(TEST_URI, true, 0);
    void ctx.router.start(speech(2)).catch(() => undefined);
    await flush();
    expect(ctx.base.starts).toEqual([]);
    await ctx.clock.advance(80);
    const before = pauses(ctx.sdk.player.calls);
    ctx.sdk.player.state(TEST_URI, false, 80);
    expect(pauses(ctx.sdk.player.calls)).toBe(before + 1);
    expect(ctx.overlapping()).toBe(false);
    ctx.sdk.player.state(TEST_URI, true, 90);
    await ctx.clock.advance(499);
    expect(ctx.base.starts).toEqual([]);
    await ctx.clock.advance(1);
    expect(ctx.base.starts).toEqual(['speech']);
    expect(ctx.overlapping()).toBe(false);
  });

  it('play 在路上時切段：遲到那首先回報已暫停、80ms 後才出聲 → 介紹仍等穩定靜音', async () => {
    const ctx = webRouter();
    await ctx.online();
    void ctx.router.start(track(1)).catch(() => undefined);
    await flush();
    void ctx.router.start(speech(2)).catch(() => undefined);
    await flush();
    ctx.remote.landPlay();
    await flush();
    ctx.sdk.player.state(TEST_URI, true, 0);
    await ctx.clock.advance(80);
    expect(ctx.base.starts).toEqual([]);
    ctx.sdk.player.state(TEST_URI, false, 80);
    expect(ctx.overlapping()).toBe(false);
    ctx.sdk.player.state(TEST_URI, true, 90);
    // 又出聲過：穩定時間從最後一次「已暫停」重新算。
    await ctx.clock.advance(499);
    expect(ctx.base.starts).toEqual([]);
    await ctx.clock.advance(1);
    expect(ctx.base.starts).toEqual(['speech']);
  });

  it('「載入中」的已暫停不算安靜；載入完成且已暫停並穩定後才算', async () => {
    const ctx = webRouter();
    await ctx.online();
    void ctx.router.start(track(1)).catch(() => undefined);
    await flush();
    void ctx.router.start(speech(2)).catch(() => undefined);
    await flush();
    ctx.remote.landPlay();
    await flush();
    ctx.sdk.player.state(TEST_URI, true, 0, [], true);
    await ctx.clock.advance(1000);
    expect(ctx.base.starts).toEqual([]);
    ctx.sdk.player.state(TEST_URI, true, 0, [], false);
    await ctx.clock.advance(500);
    expect(ctx.base.starts).toEqual(['speech']);
  });

  it('穩定期間沒有新狀態也會結束等待（不靠下一個 SDK 事件）', async () => {
    const ctx = webRouter();
    await ctx.online();
    void ctx.router.start(track(1)).catch(() => undefined);
    await flush();
    void ctx.router.start(speech(2)).catch(() => undefined);
    await flush();
    ctx.remote.landPlay();
    await flush();
    ctx.sdk.player.state(TEST_URI, true, 0);
    expect(ctx.adapter.isAudible()).toBe(true);
    await ctx.clock.advance(500);
    expect(ctx.adapter.isAudible()).toBe(false);
    expect(ctx.base.starts).toEqual(['speech']);
  });

  it('已確認在播的歌被切段：SDK 回報已暫停即可開始介紹（正常暫停不需要額外等待）', async () => {
    const ctx = webRouter();
    await ctx.online();
    void ctx.router.start(track(1)).catch(() => undefined);
    await flush();
    ctx.remote.landPlay();
    await flush();
    ctx.sdk.player.state(TEST_URI, false, 10);
    expect(ctx.events).toEqual([{ type: 'started', attemptId: 1, owner: 'track' }]);
    void ctx.router.start(speech(2)).catch(() => undefined);
    await flush();
    expect(ctx.base.starts).toEqual([]);
    ctx.sdk.player.state(TEST_URI, true, 20);
    await flush();
    expect(ctx.base.starts).toEqual(['speech']);
  });

  it('介紹播放中 SDK 晚出聲（超過穩定時間）：立刻再暫停並停介紹，回報介紹失敗', async () => {
    const ctx = webRouter();
    await ctx.online();
    void ctx.router.start(track(1)).catch(() => undefined);
    await flush();
    void ctx.router.start(speech(2)).catch(() => undefined);
    await flush();
    ctx.remote.landPlay();
    await flush();
    ctx.sdk.player.state(TEST_URI, true, 0);
    await ctx.clock.advance(500);
    expect(ctx.base.starts).toEqual(['speech']);
    const before = pauses(ctx.sdk.player.calls);
    ctx.sdk.player.state(TEST_URI, false, 600);
    expect(pauses(ctx.sdk.player.calls)).toBe(before + 1);
    expect(ctx.base.playing).toBe(false);
    expect(ctx.events).toEqual([{ type: 'failed', attemptId: 2, owner: 'speech', code: 'AUDIO_SOURCE_FAILED' }]);
  });

  it('介紹結束、換到歌曲後就不再守候：新歌的狀態不會被當成疊音', async () => {
    const ctx = webRouter();
    await ctx.online();
    await ctx.router.start(speech(1));
    void ctx.router.start(track(2)).catch(() => undefined);
    await flush();
    ctx.remote.landPlay();
    await flush();
    ctx.sdk.player.state(TEST_URI, false, 10);
    expect(ctx.events).toEqual([{ type: 'started', attemptId: 2, owner: 'track' }]);
  });
});

describe('mutation 補測（BRA-111）', () => {
  /** 路徑 C：play 生效後被 stop，正在主動確認靜音。 */
  async function connectPendingSilence() {
    const ctx = connectRouter();
    void ctx.adapter.start(track(1)).catch(() => undefined);
    await flush();
    ctx.adapter.stop();
    ctx.remote.playbackState = quiet;
    ctx.remote.landPlay();
    await flush();
    return ctx;
  }

  it('C：確認靜音期間就開始守候 → 確認中裝置出聲也會通知（只一次）', async () => {
    const ctx = await connectPendingSilence();
    const leaks: number[] = [];
    ctx.adapter.holdSilence(() => leaks.push(1));
    ctx.remote.playbackState = playingOn(TEST_URI);
    await ctx.clock.advance(1500);
    expect(leaks).toEqual([1]);
  });

  it('C：確認靜音期間開始守候 → 確認完成後改用低頻守候，之後出聲仍會通知', async () => {
    const ctx = await connectPendingSilence();
    const leaks: number[] = [];
    ctx.adapter.holdSilence(() => leaks.push(1));
    await ctx.clock.advance(2500);
    expect(ctx.adapter.isAudible()).toBe(false);
    ctx.remote.playbackState = playingOn(TEST_URI);
    await ctx.clock.advance(2000);
    expect(leaks).toEqual([1]);
  });

  it('C：別台裝置在播不算這台出聲，不停介紹', async () => {
    const ctx = connectRouter();
    await introAfterSlowLanding(ctx);
    ctx.remote.playbackState = { deviceId: 'TESTotherDevice', isPlaying: true, uri: TEST_URI, progressMs: 100, durationMs: 200_000 };
    await ctx.clock.advance(4000);
    expect(ctx.base.playing).toBe(true);
    expect(ctx.events).toEqual([]);
  });

  it('C：守候查詢途中切到背景 → 不再排下一次', async () => {
    const ctx = connectRouter();
    await introAfterSlowLanding(ctx);
    const playback = ctx.remote.playback;
    ctx.remote.playback = () => {
      ctx.visibility.set(false);
      return playback();
    };
    await ctx.clock.advance(2000);
    ctx.remote.playback = playback;
    const callsBefore = ctx.remote.playbackCalls;
    await ctx.clock.advance(10_000);
    expect(ctx.remote.playbackCalls).toBe(callsBefore);
  });

  it('C：介紹結束換到 Spotify 歌後解除守候，只剩播放中輪詢（不會每 2 秒查兩次）', async () => {
    const ctx = connectRouter();
    await introAfterSlowLanding(ctx);
    void ctx.router.start(track(3)).catch(() => undefined);
    await flush();
    ctx.remote.playbackState = playingOn(TEST_URI);
    ctx.remote.landPlay();
    await flush();
    const callsBefore = ctx.remote.playbackCalls;
    await ctx.clock.advance(10_000);
    expect(ctx.remote.playbackCalls - callsBefore).toBe(5);
  });
});

describe('守候上限（審查建議 1：介紹暫停／等點擊時不能無限輪詢）', () => {
  it('介紹被暫停、頁面一直在前景 10 分鐘：守候最多 60 秒（≤ 30 次查詢），之後不再查', async () => {
    const ctx = connectRouter();
    await introAfterSlowLanding(ctx);
    ctx.router.pause();
    const callsBefore = ctx.remote.playbackCalls;
    await ctx.clock.advance(60_000);
    const withinCap = ctx.remote.playbackCalls - callsBefore;
    expect(withinCap).toBeGreaterThan(0);
    expect(withinCap).toBeLessThanOrEqual(30);
    await ctx.clock.advance(9 * 60_000);
    expect(ctx.remote.playbackCalls - callsBefore).toBe(withinCap);
  });

  it('上限是硬上限：所有守候查詢都在介紹開始後 60 秒內（到點那一刻也不再查）', async () => {
    const ctx = connectRouter();
    let introAt = -1;
    const start = ctx.base.start.bind(ctx.base);
    ctx.base.start = (request) => ((introAt = ctx.clock.now), start(request));
    const checkedAt: number[] = [];
    const playback = ctx.remote.playback;
    ctx.remote.playback = () => (checkedAt.push(ctx.clock.now), playback());
    await introAfterSlowLanding(ctx);
    ctx.router.pause();
    await ctx.clock.advance(120_000);
    const guardChecks = checkedAt.filter((at) => at > introAt);
    expect(Math.max(...guardChecks)).toBeLessThan(introAt + 60_000);
    expect(Math.max(...guardChecks)).toBeGreaterThanOrEqual(introAt + 56_000);
  });

  it('超過上限後切到背景再回前景：不會重新開始守候', async () => {
    const ctx = connectRouter();
    await introAfterSlowLanding(ctx);
    await ctx.clock.advance(61_000);
    ctx.visibility.set(false);
    const callsBefore = ctx.remote.playbackCalls;
    ctx.visibility.set(true);
    await ctx.clock.advance(10_000);
    expect(ctx.remote.playbackCalls).toBe(callsBefore);
  });

  it('上限內仍照常：守候開始 58 秒時出聲也會停介紹', async () => {
    const ctx = connectRouter();
    await introAfterSlowLanding(ctx);
    await ctx.clock.advance(56_000);
    ctx.remote.playbackState = playingOn(TEST_URI);
    await ctx.clock.advance(2000);
    expect(ctx.events.map((e) => e.type)).toEqual(['failed']);
  });

  it('介紹的 <audio> 開始被拒（例如需要點一下）：立刻解除守候，不輪詢', async () => {
    const ctx = connectRouter();
    ctx.base.start = (request) => {
      ctx.base.starts.push(request.owner);
      return Promise.reject(new DOMException('需要點一下才能繼續播放。', 'NotAllowedError'));
    };
    await introAfterSlowLanding(ctx);
    expect(ctx.base.starts).toEqual(['speech']);
    const callsBefore = ctx.remote.playbackCalls;
    await ctx.clock.advance(10_000);
    expect(ctx.remote.playbackCalls).toBe(callsBefore);
  });
});

