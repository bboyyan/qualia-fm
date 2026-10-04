import { describe, expect, it } from 'vitest';
import { PlaybackEngine } from '../src/audio/engine';
import type { AdapterEvent, MediaAdapter, ProviderState, StartRequest } from '../src/audio/types';
import { captureTuneContext, commitTune, commitTuneAnyway, tuneRequest } from '../src/features/player/tuneFlow';
import { makeShow } from './fixtures';

class SilentAdapter implements MediaAdapter {
  starts: StartRequest[] = [];
  start(request: StartRequest): Promise<void> {
    this.starts.push(request);
    return Promise.resolve();
  }
  pause(): void {}
  resume(): Promise<void> {
    return Promise.resolve();
  }
  seek(): void {}
  stop(): void {}
  getState(): ProviderState | null {
    return null;
  }
  subscribe(_l: (e: AdapterEvent) => void): () => void {
    return () => undefined;
  }
  destroy(): void {}
}

function playingEngine() {
  const adapter = new SilentAdapter();
  const engine = new PlaybackEngine(adapter, { djEnabled: false, canSeek: true });
  engine.loadShow(makeShow('showA'));
  engine.play();
  return { engine, adapter };
}

describe('tune flow', () => {
  it('builds a request from the current seed plus the user tuning only', () => {
    const request = tuneRequest(makeShow('showA'), ' 更放鬆 ', { enabled: true, length: 'short' });
    expect([request.seed.text, request.tuning, request.requestedCount]).toEqual(['深夜', '更放鬆', 5]);
  });

  it('replaces only the tail and never restarts the current track (AC22)', () => {
    const { engine, adapter } = playingEngine();
    const context = captureTuneContext(engine)!;
    const outcome = commitTune(engine, makeShow('showB', 5), context);
    expect([outcome, adapter.starts.length, engine.getState().queue[0]?.segment.segmentId, engine.getState().queue.length]).toEqual([
      { kind: 'committed', count: 5 },
      1,
      'showA_1',
      6,
    ]);
  });

  it('keeps the old tail when the replacement has no playable tracks', () => {
    const { engine } = playingEngine();
    const before = engine.getState().queue;
    expect([commitTune(engine, makeShow('showB', 0), captureTuneContext(engine)!), engine.getState().queue]).toEqual([{ kind: 'empty' }, before]);
  });

  it('refuses a result whose queue revision went stale, until the user confirms', () => {
    const { engine } = playingEngine();
    const context = captureTuneContext(engine)!;
    engine.removeUpcoming('showA_3');
    const stale = commitTune(engine, makeShow('showB', 2), context);
    const confirmed = commitTuneAnyway(engine, makeShow('showB', 2), context.sessionId);
    expect([stale.kind, confirmed.kind]).toEqual(['stale_revision', 'committed']);
  });

  it('discards a result that belongs to a previous show session', () => {
    const { engine } = playingEngine();
    const context = captureTuneContext(engine)!;
    engine.loadShow(makeShow('showC'));
    expect(commitTune(engine, makeShow('showB', 2), context).kind).toBe('stale_session');
  });
});
