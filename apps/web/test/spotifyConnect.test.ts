import { describe, expect, it } from 'vitest';
import { SpotifyConnectAdapter } from '../src/audio/adapters/spotifyConnectAdapter';
import { PAUSE_RECONNECT_MS } from '../src/audio/adapters/spotifyWebPlaybackAdapter';
import type { AdapterEvent } from '../src/audio/types';
import type { SpotifyDeviceStatus } from '../src/audio/spotify/types';
import { FakeClock, FakeRemote, FakeVisibility, OTHER_URI, TEST_URI, flush, spotifySegment } from './spotifyFakes';

function setup(options: { gesture?: boolean } = {}) {
  const remote = new FakeRemote();
  const clock = new FakeClock();
  const visibility = new FakeVisibility();
  const statuses: SpotifyDeviceStatus[] = [];
  const adapter = new SpotifyConnectAdapter({
    remote,
    deviceId: 'TESTphone',
    deviceName: 'TEST iPhone',
    timers: clock,
    now: () => clock.now,
    hasUserGesture: () => options.gesture ?? false,
    visibility,
    report: (status) => statuses.push(status),
  });
  const events: AdapterEvent[] = [];
  adapter.subscribe((event) => events.push(event));
  return { remote, clock, visibility, statuses, adapter, events };
}

const startTrack = (ctx: ReturnType<typeof setup>, attemptId = 1, fromMs = 0) =>
  ctx.adapter.start({ owner: 'track', segment: spotifySegment(), attemptId, fromMs });

const playing = (uri = TEST_URI, progressMs = 1000, isPlaying = true) => ({ deviceId: 'TESTphone', isPlaying, uri, progressMs, durationMs: 200_000 });

describe('SpotifyConnectAdapter（路徑 C：遙控 Spotify app）', () => {
  it('每首前就緒檢查：裝置不在清單且不在手勢內 → 點一下繼續，不送 play', async () => {
    const ctx = setup();
    ctx.remote.devicesList = [];
    expect(((await startTrack(ctx).catch((e: unknown) => e)) as DOMException).name).toBe('NotAllowedError');
    expect(ctx.remote.plays).toEqual([]);
  });

  it('點一下後仍找不到裝置 → DeviceUnavailableError（三段提示），仍不送 play', async () => {
    const ctx = setup({ gesture: true });
    ctx.remote.devicesList = [];
    expect(((await startTrack(ctx).catch((e: unknown) => e)) as DOMException).name).toBe('DeviceUnavailableError');
    expect(ctx.remote.plays).toEqual([]);
    expect(ctx.statuses.at(-1)).toMatchObject({ path: 'C', state: 'offline', reason: 'not_found' });
  });

  it('指令帶 device_id；輪詢確認在播才回報 started', async () => {
    const ctx = setup();
    await startTrack(ctx, 5, 2000);
    expect(ctx.remote.plays).toEqual([{ deviceId: 'TESTphone', uri: TEST_URI, positionMs: 2000 }]);
    await ctx.clock.advance(2000);
    expect(ctx.events).toEqual([]);
    ctx.remote.playbackState = playing();
    await ctx.clock.advance(2000);
    expect(ctx.events).toEqual([{ type: 'started', attemptId: 5, owner: 'track' }]);
  });

  it('只在頁面可見時輪詢；回前景立即確認一次', async () => {
    const ctx = setup();
    await startTrack(ctx);
    ctx.visibility.set(false);
    const before = ctx.remote.playbackCalls;
    await ctx.clock.advance(30_000);
    expect(ctx.remote.playbackCalls).toBe(before);
    ctx.remote.playbackState = playing();
    ctx.visibility.set(true);
    await flush();
    expect(ctx.remote.playbackCalls).toBe(before + 1);
    expect(ctx.events.at(-1)).toMatchObject({ type: 'started' });
  });

  it('404 NO_ACTIVE_DEVICE → DeviceUnavailableError', async () => {
    const ctx = setup();
    ctx.remote.failNextPlay = 'DEVICE_UNAVAILABLE';
    expect(((await startTrack(ctx).catch((e: unknown) => e)) as DOMException).name).toBe('DeviceUnavailableError');
  });

  it('曲目換掉或停在 0 → ended 一次；裝置不見 → device_lost', async () => {
    const ctx = setup();
    await startTrack(ctx, 2);
    ctx.remote.playbackState = playing();
    await ctx.clock.advance(2000);
    ctx.remote.playbackState = playing(OTHER_URI, 10);
    await ctx.clock.advance(2000);
    await ctx.clock.advance(2000);
    expect(ctx.events.filter((e) => e.type === 'ended')).toEqual([{ type: 'ended', attemptId: 2, owner: 'track' }]);
    await startTrack(ctx, 3);
    ctx.remote.playbackState = playing();
    await ctx.clock.advance(2000);
    ctx.remote.playbackState = { deviceId: null, isPlaying: false, uri: null, progressMs: 0, durationMs: null };
    await ctx.clock.advance(2000);
    expect(ctx.events.at(-1)).toEqual({ type: 'device_lost' });
    expect(ctx.adapter.getState()).toBeNull();
  });

  it('暫停時停止輪詢；暫停超過 10 分鐘 → 需重連，不直接送 play', async () => {
    const ctx = setup();
    await startTrack(ctx, 2);
    ctx.remote.playbackState = playing(TEST_URI, 5000);
    await ctx.clock.advance(2000);
    ctx.adapter.pause();
    expect(ctx.remote.pauses).toEqual(['TESTphone']);
    const calls = ctx.remote.playbackCalls;
    await ctx.clock.advance(PAUSE_RECONNECT_MS + 1000);
    expect(ctx.remote.playbackCalls).toBe(calls);
    expect(((await ctx.adapter.resume(2).catch((e: unknown) => e)) as DOMException).name).toBe('DeviceUnavailableError');
    expect(ctx.remote.plays).toHaveLength(1);
    expect(ctx.statuses.at(-1)).toMatchObject({ reason: 'paused_too_long' });
  });
});

describe('mutation 補測（BRA-111 重跑 PR #6）', () => {
  it('W04：送出後一直沒確認在播（12 秒）→ 當成需要點一下，並送 pause 避免晚到的聲音', async () => {
    const ctx = setup();
    await startTrack(ctx, 3);
    await ctx.clock.advance(14_000);
    expect(ctx.events).toEqual([{ type: 'failed', attemptId: 3, owner: 'track', code: 'AUTOPLAY_BLOCKED' }]);
    expect(ctx.remote.pauses).toEqual(['TESTphone']);
  });

  it('W07：頁面在背景時開始播放 → 不輪詢', async () => {
    const ctx = setup();
    ctx.visibility.visible = false;
    await startTrack(ctx);
    await ctx.clock.advance(30_000);
    expect(ctx.remote.playbackCalls).toBe(0);
  });
});

