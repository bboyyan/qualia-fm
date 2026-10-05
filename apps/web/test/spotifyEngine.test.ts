import { describe, expect, it } from 'vitest';
import { PlaybackEngine, classifyPlayError } from '../src/audio/engine';
import type { AdapterEvent, MediaAdapter, ProviderState, StartRequest } from '../src/audio/types';
import { makeShow } from './fixtures';
import { flush } from './spotifyFakes';

class ScriptedAdapter implements MediaAdapter {
  readonly starts: StartRequest[] = [];
  private listener: ((event: AdapterEvent) => void) | null = null;
  nextError: string | null = null;
  online = true;
  start(request: StartRequest): Promise<void> {
    this.starts.push(request);
    if (this.nextError) {
      const name = this.nextError;
      this.nextError = null;
      return Promise.reject(new DOMException('scripted', name));
    }
    return Promise.resolve();
  }
  pause(): void {}
  resume(): Promise<void> { return Promise.resolve(); }
  seek(): void {}
  stop(): void {}
  getState(): ProviderState | null { return this.online ? { positionMs: 0, durationMs: 30_000, paused: false, ready: true } : null; }
  subscribe(listener: (event: AdapterEvent) => void): () => void { this.listener = listener; return () => (this.listener = null); }
  destroy(): void {}
  emit(event: AdapterEvent): void { this.listener?.(event); }
}

function engineWith(adapter: ScriptedAdapter) {
  const engine = new PlaybackEngine(adapter, { djEnabled: true, canSeek: true, playbackMode: 'spotify', feedbackEnabled: true });
  engine.loadShow(makeShow());
  return engine;
}

describe('E 模式（spotify）在引擎中的行為', () => {
  it('DeviceUnavailableError 分類為裝置離線', () => {
    expect(classifyPlayError(new DOMException('x', 'DeviceUnavailableError'))).toBe('DEVICE_UNAVAILABLE');
  });

  it('spotify 模式與 MOCK 一樣自動接續：介紹結束才開始曲目', () => {
    const adapter = new ScriptedAdapter();
    const engine = engineWith(adapter);
    engine.play();
    expect(adapter.starts.map((s) => s.owner)).toEqual(['speech']);
    adapter.emit({ type: 'started', attemptId: engine.getState().attemptId, owner: 'speech' });
    adapter.emit({ type: 'ended', attemptId: engine.getState().attemptId, owner: 'speech' });
    expect(adapter.starts.map((s) => s.owner)).toEqual(['speech', 'track']);
    expect(engine.getState().phase).toBe('loading_track');
    adapter.emit({ type: 'started', attemptId: engine.getState().attemptId, owner: 'track' });
    expect(engine.getState().phase).toBe('track_playing');
  });

  it('曲目開始時裝置不在 → 停在可恢復的「裝置離線」，保留同一首，不自動跳下一首', async () => {
    const adapter = new ScriptedAdapter();
    const engine = engineWith(adapter);
    engine.play();
    adapter.online = false;
    adapter.nextError = 'DeviceUnavailableError';
    engine.skipIntro();
    await flush();
    expect(engine.getState()).toMatchObject({ phase: 'recoverable_error', currentIndex: 0, pendingOwner: 'track', error: { code: 'DEVICE_UNAVAILABLE' } });
    adapter.online = true;
    engine.play();
    expect(adapter.starts.at(-1)).toMatchObject({ owner: 'track', segment: { segmentId: 'showA_1' } });
  });

  it('播放中 adapter 回報 device_lost → 重新確認 → 離線就停下等待', async () => {
    const adapter = new ScriptedAdapter();
    const engine = engineWith(adapter);
    engine.play();
    engine.skipIntro();
    adapter.emit({ type: 'started', attemptId: engine.getState().attemptId, owner: 'track' });
    adapter.online = false;
    adapter.emit({ type: 'device_lost' });
    await flush();
    expect(engine.getState()).toMatchObject({ phase: 'recoverable_error', error: { code: 'DEVICE_UNAVAILABLE' } });
  });
});
