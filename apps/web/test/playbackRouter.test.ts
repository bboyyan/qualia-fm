import { describe, expect, it } from 'vitest';
import { PlaybackRouter } from '../src/audio/adapters/playbackRouter';
import type { SpotifyOutput } from '../src/audio/spotify/types';
import type { AdapterEvent, MediaAdapter, ProviderState, StartRequest } from '../src/audio/types';
import { segment } from './fixtures';
import { spotifySegment } from './spotifyFakes';

/** 記錄每個來源的出聲狀態與呼叫順序；同一時間出聲的來源數必須永遠 ≤ 1。 */
class Room {
  readonly log: string[] = [];
  private readonly audible = new Set<string>();
  maxConcurrent = 0;
  on(name: string): void {
    this.audible.add(name);
    this.maxConcurrent = Math.max(this.maxConcurrent, this.audible.size);
  }
  off(name: string): void {
    this.audible.delete(name);
  }
}

class FakeBase implements MediaAdapter {
  private listener: ((event: AdapterEvent) => void) | null = null;
  playing = false;
  constructor(private readonly room: Room) {}
  start(request: StartRequest): Promise<void> {
    this.room.log.push(`base.start:${request.owner}`);
    this.playing = true;
    this.room.on('base');
    return Promise.resolve();
  }
  pause(): void { this.playing = false; this.room.off('base'); }
  resume(): Promise<void> { return Promise.resolve(); }
  seek(): void {}
  stop(): void {
    this.room.log.push('base.stop');
    this.playing = false;
    this.room.off('base');
  }
  getState(): ProviderState | null { return { positionMs: 0, durationMs: null, paused: !this.playing, ready: true }; }
  subscribe(listener: (event: AdapterEvent) => void): () => void { this.listener = listener; return () => (this.listener = null); }
  destroy(): void {}
  emit(event: AdapterEvent): void { this.listener?.(event); }
}

class FakeOutput implements SpotifyOutput {
  readonly path = 'P' as const;
  private listener: ((event: AdapterEvent) => void) | null = null;
  playing = false;
  silentResult = true;
  constructor(private readonly room: Room) {}
  start(request: StartRequest): Promise<void> {
    this.room.log.push(`spotify.start:${request.owner}`);
    this.playing = true;
    this.room.on('spotify');
    return Promise.resolve();
  }
  pause(): void { this.playing = false; this.room.off('spotify'); }
  resume(): Promise<void> { return Promise.resolve(); }
  seek(): void {}
  stop(): void { this.room.log.push('spotify.stop'); }
  getState(): ProviderState | null { return null; }
  subscribe(listener: (event: AdapterEvent) => void): () => void { this.listener = listener; return () => (this.listener = null); }
  destroy(): void {}
  isAudible(): boolean { return this.playing; }
  whenSilent(): Promise<boolean> {
    this.room.log.push('spotify.whenSilent');
    if (this.silentResult) {
      this.playing = false;
      this.room.off('spotify');
    }
    return Promise.resolve(this.silentResult);
  }
  recheck(): Promise<boolean> { return Promise.resolve(true); }
  emit(event: AdapterEvent): void { this.listener?.(event); }
}

function setup(withOutput = true) {
  const room = new Room();
  const base = new FakeBase(room);
  const output = new FakeOutput(room);
  const router = new PlaybackRouter(base);
  if (withOutput) router.setSpotifyOutput(output);
  const events: AdapterEvent[] = [];
  router.subscribe((event) => events.push(event));
  return { room, base, output, router, events };
}

const speech = { owner: 'speech' as const, segment: spotifySegment(), attemptId: 1, fromMs: 0 };
const track = { owner: 'track' as const, segment: spotifySegment(), attemptId: 2, fromMs: 0 };

describe('PlaybackRouter：介紹播完、確認已停才放歌；不疊、不 ducking', () => {
  it('沒有 Spotify 輸出時完全照舊交給單一 <audio>', async () => {
    const ctx = setup(false);
    await ctx.router.start({ owner: 'track', segment: segment('s', 1), attemptId: 1, fromMs: 0 });
    expect(ctx.room.log).toEqual(['base.start:track']);
    ctx.base.emit({ type: 'ended', attemptId: 1, owner: 'track' });
    expect(ctx.events).toEqual([{ type: 'ended', attemptId: 1, owner: 'track' }]);
  });

  it('Spotify 歌：先停掉介紹的 <audio> 再送 Spotify', async () => {
    const ctx = setup();
    await ctx.router.start(speech);
    await ctx.router.start(track);
    expect(ctx.room.log).toEqual(['base.start:speech', 'base.stop', 'spotify.start:track']);
    expect(ctx.room.maxConcurrent).toBe(1);
  });

  it('Spotify 正在出聲時要播介紹：等 Spotify 確認靜音才開始', async () => {
    const ctx = setup();
    await ctx.router.start(track);
    await ctx.router.start({ ...speech, attemptId: 3 });
    expect(ctx.room.log).toEqual(['base.stop', 'spotify.start:track', 'spotify.stop', 'spotify.whenSilent', 'base.start:speech']);
    expect(ctx.room.maxConcurrent).toBe(1);
  });

  it('Spotify 沒確認靜音 → 介紹不播（交由引擎改顯示文字），絕不疊', async () => {
    const ctx = setup();
    await ctx.router.start(track);
    ctx.output.silentResult = false;
    const error = await ctx.router.start({ ...speech, attemptId: 3 }).catch((e: unknown) => e);
    expect((error as DOMException).name).toBe('NotSupportedError');
    expect(ctx.room.log).not.toContain('base.start:speech');
    expect(ctx.room.maxConcurrent).toBe(1);
  });

  it('MOCK 測試音曲目即使有 Spotify 輸出也走 <audio>', async () => {
    const ctx = setup();
    await ctx.router.start({ owner: 'track', segment: segment('s', 1), attemptId: 1, fromMs: 0 });
    expect(ctx.room.log).toEqual(['base.start:track']);
  });

  it('Spotify 歌但沒有 Spotify 輸出 → 不播（AUDIO_SOURCE_FAILED），不碰 <audio>', async () => {
    const ctx = setup(false);
    const error = await ctx.router.start(track).catch((e: unknown) => e);
    expect((error as DOMException).name).toBe('NotSupportedError');
    expect(ctx.room.log).toEqual([]);
  });

  it('轉送兩邊事件；拔掉 Spotify 輸出後不再轉送它的事件', async () => {
    const ctx = setup();
    ctx.output.emit({ type: 'device_lost' });
    ctx.router.setSpotifyOutput(null);
    ctx.output.emit({ type: 'started', attemptId: 9, owner: 'track' });
    expect(ctx.events).toEqual([{ type: 'device_lost' }]);
  });
});
