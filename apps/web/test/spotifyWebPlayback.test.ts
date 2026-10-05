import { describe, expect, it } from 'vitest';
import { SpotifyWebPlaybackAdapter, PAUSE_RECONNECT_MS } from '../src/audio/adapters/spotifyWebPlaybackAdapter';
import type { AdapterEvent } from '../src/audio/types';
import type { SpotifyDeviceStatus } from '../src/audio/spotify/types';
import { FakeClock, FakeRemote, FakeSdk, FakeVisibility, OTHER_URI, TEST_URI, flush, spotifySegment } from './spotifyFakes';

function setup(options: { gesture?: boolean } = {}) {
  const sdk = new FakeSdk();
  const remote = new FakeRemote();
  const clock = new FakeClock();
  const visibility = new FakeVisibility();
  const statuses: SpotifyDeviceStatus[] = [];
  const adapter = new SpotifyWebPlaybackAdapter({
    loadSdk: sdk.load,
    remote,
    timers: clock,
    now: () => clock.now,
    hasUserGesture: () => options.gesture ?? false,
    visibility,
    report: (status) => statuses.push(status),
  });
  const events: AdapterEvent[] = [];
  adapter.subscribe((event) => events.push(event));
  return { sdk, remote, clock, visibility, statuses, adapter, events };
}

async function online(ctx: ReturnType<typeof setup>): Promise<void> {
  const connecting = ctx.adapter.connect();
  await flush();
  ctx.sdk.player.ready();
  expect(await connecting).toBe(true);
}

const startTrack = (ctx: ReturnType<typeof setup>, attemptId = 1, fromMs = 0) =>
  ctx.adapter.start({ owner: 'track', segment: spotifySegment(), attemptId, fromMs });

describe('SpotifyWebPlaybackAdapter（路徑 P：網頁當 Connect 裝置）', () => {
  it('建立時不載入 SDK；只有使用者點擊（connect）才載入，且先 activateElement 再 connect', async () => {
    const ctx = setup();
    expect(ctx.sdk.loads).toBe(0);
    await online(ctx);
    expect(ctx.sdk.loads).toBe(1);
    expect(ctx.sdk.player.calls.slice(0, 2)).toEqual(['activateElement', 'connect']);
    expect(ctx.statuses.at(-1)).toMatchObject({ path: 'P', state: 'online' });
    expect(ctx.sdk.player.options.name).toBe('Qualia FM');
  });

  it('SDK 的 token 來自伺服器短期 token 端點', async () => {
    const ctx = setup();
    await online(ctx);
    const token = await new Promise<string>((resolve) => ctx.sdk.player.options.getOAuthToken(resolve));
    expect(token).toBe('TEST-access');
  });

  it('沒有就緒且不在使用者手勢內：停在「點一下繼續」，不載 SDK、不盲送 play', async () => {
    const ctx = setup();
    const error = await startTrack(ctx).catch((e: unknown) => e);
    expect((error as DOMException).name).toBe('NotAllowedError');
    expect(ctx.sdk.loads).toBe(0);
    expect(ctx.remote.plays).toEqual([]);
  });

  it('不在就緒但在手勢內：先重新接上，就緒後才送 play', async () => {
    const ctx = setup({ gesture: true });
    const starting = startTrack(ctx);
    await flush();
    expect(ctx.remote.plays).toEqual([]);
    ctx.sdk.player.ready();
    await starting;
    expect(ctx.remote.plays).toEqual([{ deviceId: 'TESTdeviceP', uri: TEST_URI, positionMs: 0 }]);
  });

  it('送出 play 後要等 player_state_changed 確認真的在播，才回報 started', async () => {
    const ctx = setup();
    await online(ctx);
    await startTrack(ctx, 7, 3000);
    expect(ctx.remote.plays).toEqual([{ deviceId: 'TESTdeviceP', uri: TEST_URI, positionMs: 3000 }]);
    expect(ctx.events).toEqual([]);
    ctx.sdk.player.state(TEST_URI, true);
    expect(ctx.events).toEqual([]);
    ctx.sdk.player.state(TEST_URI, false, 3100);
    expect(ctx.events).toEqual([{ type: 'started', attemptId: 7, owner: 'track' }]);
    expect(ctx.adapter.getState()).toMatchObject({ paused: false, ready: true });
  });

  it('autoplay_failed → AUTOPLAY_BLOCKED（點一下繼續）', async () => {
    const ctx = setup();
    await online(ctx);
    await startTrack(ctx, 3);
    ctx.sdk.player.emit('autoplay_failed');
    expect(ctx.events).toEqual([{ type: 'failed', attemptId: 3, owner: 'track', code: 'AUTOPLAY_BLOCKED' }]);
  });

  it('送出後一直沒有確認在播 → 逾時視為需要點一下，並暫停避免晚到的聲音', async () => {
    const ctx = setup();
    await online(ctx);
    await startTrack(ctx, 4);
    await ctx.clock.advance(10_000);
    expect(ctx.events).toEqual([{ type: 'failed', attemptId: 4, owner: 'track', code: 'AUTOPLAY_BLOCKED' }]);
    expect(ctx.sdk.player.calls).toContain('pause');
  });

  it('播完（暫停在 0 且曲目進到上一首）只回報一次 ended', async () => {
    const ctx = setup();
    await online(ctx);
    await startTrack(ctx, 2);
    ctx.sdk.player.state(TEST_URI, false, 10);
    ctx.sdk.player.state(TEST_URI, false, 150_000);
    ctx.sdk.player.state(OTHER_URI, true, 0, [TEST_URI]);
    ctx.sdk.player.state(OTHER_URI, true, 0, [TEST_URI]);
    expect(ctx.events.filter((e) => e.type === 'ended')).toEqual([{ type: 'ended', attemptId: 2, owner: 'track' }]);
  });

  it('播放中 not_ready → device_lost，getState 回 null', async () => {
    const ctx = setup();
    await online(ctx);
    await startTrack(ctx, 2);
    ctx.sdk.player.state(TEST_URI, false, 10);
    ctx.sdk.player.emit('not_ready', { device_id: 'TESTdeviceP' });
    expect(ctx.events.at(-1)).toEqual({ type: 'device_lost' });
    expect(ctx.adapter.getState()).toBeNull();
    expect(ctx.statuses.at(-1)).toMatchObject({ state: 'offline' });
  });

  it('伺服器回 404 NO_ACTIVE_DEVICE → DeviceUnavailableError，狀態離線', async () => {
    const ctx = setup();
    await online(ctx);
    ctx.remote.failNextPlay = 'DEVICE_UNAVAILABLE';
    const error = await startTrack(ctx).catch((e: unknown) => e);
    expect((error as DOMException).name).toBe('DeviceUnavailableError');
    expect(ctx.statuses.at(-1)).toMatchObject({ state: 'offline', reason: 'not_found' });
  });

  it('需要 Premium（account error）→ 離線並標示帳號原因', async () => {
    const ctx = setup();
    await online(ctx);
    ctx.remote.failNextPlay = 'SPOTIFY_ACCOUNT_ERROR';
    expect(((await startTrack(ctx).catch((e: unknown) => e)) as DOMException).name).toBe('DeviceUnavailableError');
    expect(ctx.statuses.at(-1)).toMatchObject({ state: 'offline', reason: 'account' });
  });

  it('暫停不到 10 分鐘可直接繼續；超過 10 分鐘視為需重連，不直接送 resume', async () => {
    const ctx = setup();
    await online(ctx);
    await startTrack(ctx, 2);
    ctx.sdk.player.state(TEST_URI, false, 10);
    ctx.adapter.pause();
    ctx.sdk.player.state(TEST_URI, true, 20_000);
    await ctx.clock.advance(5 * 60 * 1000);
    await ctx.adapter.resume(2);
    expect(ctx.sdk.player.calls.filter((c) => c === 'resume')).toHaveLength(1);
    ctx.sdk.player.state(TEST_URI, false, 20_100);
    ctx.adapter.pause();
    ctx.sdk.player.state(TEST_URI, true, 30_000);
    await ctx.clock.advance(PAUSE_RECONNECT_MS + 1000);
    const error = await ctx.adapter.resume(2).catch((e: unknown) => e);
    expect((error as DOMException).name).toBe('DeviceUnavailableError');
    expect(ctx.sdk.player.calls.filter((c) => c === 'resume')).toHaveLength(1);
    expect(ctx.statuses.at(-1)).toMatchObject({ state: 'offline', reason: 'paused_too_long' });
  });

  it('重新偵測／回到前景才讀狀態；背景時不做任何輪詢', async () => {
    const ctx = setup();
    await online(ctx);
    ctx.visibility.set(false);
    await ctx.clock.advance(60_000);
    expect(ctx.sdk.player.calls).not.toContain('getCurrentState');
    ctx.visibility.set(true);
    await flush();
    expect(ctx.sdk.player.calls).toContain('getCurrentState');
    expect(ctx.clock.pending).toBe(0);
  });

  it('stop 會暫停正在播的歌；whenSilent 等到 SDK 確認暫停', async () => {
    const ctx = setup();
    await online(ctx);
    await startTrack(ctx, 2);
    ctx.sdk.player.state(TEST_URI, false, 10);
    expect(ctx.adapter.isAudible()).toBe(true);
    const silent = ctx.adapter.whenSilent(2000);
    ctx.adapter.stop();
    expect(ctx.sdk.player.calls).toContain('pause');
    ctx.sdk.player.state(TEST_URI, true, 500);
    expect(await silent).toBe(true);
    expect(ctx.adapter.isAudible()).toBe(false);
  });

  it('不接受非 Spotify 音源或介紹語音', async () => {
    const ctx = setup();
    await online(ctx);
    const error = await ctx.adapter.start({ owner: 'speech', segment: spotifySegment(), attemptId: 1, fromMs: 0 }).catch((e: unknown) => e);
    expect((error as DOMException).name).toBe('NotSupportedError');
  });
});
