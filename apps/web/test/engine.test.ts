import { describe, expect, it } from 'vitest';
import { PlaybackEngine, classifyPlayError } from '../src/audio/engine';
import type { AdapterEvent, MediaAdapter, OwnerKind, ProviderState, StartRequest } from '../src/audio/types';
import { makeShow } from './fixtures';

/**
 * Models one physical output: only the latest started source can be audible, and the test
 * records the maximum number of simultaneously audible sources ever observed.
 */
class FakeAdapter implements MediaAdapter {
  readonly starts: StartRequest[] = [];
  private listener: ((event: AdapterEvent) => void) | null = null;
  private audible = new Set<number>();
  maxConcurrent = 0;
  rejectNext: string | null = null;
  current: StartRequest | null = null;

  start(request: StartRequest): Promise<void> {
    this.starts.push(request);
    this.audible.clear();
    this.current = request;
    if (this.rejectNext) {
      const name = this.rejectNext;
      this.rejectNext = null;
      return Promise.reject(new DOMException('rejected', name));
    }
    return Promise.resolve();
  }
  /** Test helper: the provider reports that the current source is now audible. */
  confirm(): void {
    if (!this.current) return;
    this.audible.add(this.current.attemptId);
    this.maxConcurrent = Math.max(this.maxConcurrent, this.audible.size);
    this.emit({ type: 'started', attemptId: this.current.attemptId, owner: this.current.owner });
  }
  end(attemptId: number, owner: OwnerKind): void {
    this.emit({ type: 'ended', attemptId, owner });
  }
  emit(event: AdapterEvent): void {
    this.listener?.(event);
  }
  pause(): void {
    this.audible.clear();
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  seek(): void {}
  stop(): void {
    this.audible.clear();
    this.current = null;
  }
  getState(): ProviderState | null {
    return { positionMs: 0, durationMs: 30_000, paused: false, ready: true };
  }
  subscribe(listener: (event: AdapterEvent) => void): () => void {
    this.listener = listener;
    return () => (this.listener = null);
  }
  destroy(): void {}
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(djEnabled = true) {
  const adapter = new FakeAdapter();
  const announcements: string[] = [];
  const engine = new PlaybackEngine(adapter, { djEnabled, canSeek: true, onAnnounce: (m) => announcements.push(m) });
  engine.loadShow(makeShow());
  return { adapter, engine, announcements };
}

describe('PlaybackEngine', () => {
  it('calls adapter.start synchronously inside play() so the tap unlocks audio', () => {
    const { adapter, engine } = setup();
    engine.play();
    expect(adapter.starts).toHaveLength(1);
  });

  it('never has two audible sources across rapid next taps (no double play, AC13)', () => {
    const { adapter, engine } = setup();
    engine.play();
    adapter.confirm();
    for (let i = 0; i < 4; i += 1) {
      engine.next();
      adapter.confirm();
    }
    expect([adapter.maxConcurrent, engine.getState().currentIndex]).toEqual([1, 4]);
  });

  it('serialises rapid next taps: each tap moves exactly one segment', () => {
    const { adapter, engine } = setup();
    engine.play();
    engine.next();
    engine.next();
    expect([engine.getState().currentIndex, adapter.starts.map((s) => s.segment.segmentId)]).toEqual([2, ['showA_1', 'showA_2', 'showA_3']]);
  });

  it('ignores a late ended event from a replaced attempt', () => {
    const { adapter, engine } = setup();
    engine.play();
    const first = adapter.starts[0]!;
    engine.next();
    adapter.end(first.attemptId, 'speech');
    expect([engine.getState().currentIndex, engine.getState().phase]).toEqual([1, 'loading_speech']);
  });

  it('turns NotAllowedError into awaiting_gesture without retrying on its own (AC24)', async () => {
    const { adapter, engine } = setup();
    adapter.rejectNext = 'NotAllowedError';
    engine.play();
    await flush();
    expect([engine.getState().phase, adapter.starts.length]).toEqual(['awaiting_gesture', 1]);
  });

  it('treats AbortError from its own pause as harmless', async () => {
    const { adapter, engine } = setup();
    adapter.rejectNext = 'AbortError';
    engine.play();
    await flush();
    expect(engine.getState().phase).toBe('loading_speech');
  });

  it('announces segment changes for the polite live region, not every second', () => {
    const { adapter, engine, announcements } = setup();
    engine.play();
    adapter.confirm();
    expect(announcements).toEqual(['DJ 介紹：曲目1']);
  });

  it('a new show replaces the session atomically and stops the old audio', () => {
    const { adapter, engine } = setup();
    engine.play();
    adapter.confirm();
    engine.loadShow(makeShow('showB'));
    expect([engine.getState().phase, adapter.current, engine.getState().queue[0]?.showId]).toEqual(['ready', null, 'showB']);
  });

  it('reconciles via the adapter state after device loss', async () => {
    const { adapter, engine } = setup(false);
    engine.play();
    adapter.confirm();
    engine.deviceLost();
    await flush();
    expect(engine.getState().phase).toBe('track_playing');
  });
});

describe('classifyPlayError', () => {
  it.each([
    ['NotAllowedError', 'AUTOPLAY_BLOCKED'],
    ['AbortError', 'ignore'],
    ['NotSupportedError', 'AUDIO_SOURCE_FAILED'],
  ])('%s → %s', (name, expected) => {
    expect(classifyPlayError(new DOMException('x', name))).toBe(expected);
  });
});

it('B mode never starts track audio and waits for feedback before next introduction', () => {
  const adapter = new FakeAdapter();
  const engine = new PlaybackEngine(adapter, { djEnabled: true, canSeek: true, playbackMode: 'manual', feedbackEnabled: true });
  engine.loadShow(makeShow());
  engine.play();
  adapter.confirm();
  adapter.end(engine.getState().attemptId, 'speech');
  expect(engine.getState().phase).toBe('manual_ready');
  expect(adapter.starts.map((s) => s.owner)).toEqual(['speech']);
  engine.manualStarted();
  expect(engine.getState().phase).toBe('manual_playing');
  engine.manualFinished();
  expect(engine.getState().phase).toBe('feedback');
  expect(engine.getState().currentIndex).toBe(0);
  engine.completeFeedback();
  expect(engine.getState().currentIndex).toBe(1);
  expect(adapter.starts.map((s) => s.owner)).toEqual(['speech', 'speech']);
});

it('mock natural completion and next-skip wait for feedback, including the final song', () => {
  const adapter = new FakeAdapter();
  const engine = new PlaybackEngine(adapter, { djEnabled: false, canSeek: true, playbackMode: 'mock', feedbackEnabled: true });
  engine.loadShow(makeShow('TEST-show', 2, false));
  engine.play();
  adapter.confirm();
  const firstAttempt = engine.getState().attemptId;
  adapter.end(firstAttempt, 'track');
  adapter.end(firstAttempt, 'track');
  expect([engine.getState().phase, engine.getState().currentIndex]).toEqual(['feedback', 0]);
  engine.next();
  expect(engine.getState().currentIndex).toBe(0);
  engine.completeFeedback();
  engine.next();
  expect([engine.getState().phase, engine.getState().currentIndex]).toEqual(['feedback', 1]);
  engine.completeFeedback();
  expect(engine.getState().phase).toBe('completed');
});

it('feedback cannot be bypassed by replaying an intro or changing playback mode', () => {
  const adapter = new FakeAdapter();
  const engine = new PlaybackEngine(adapter, { djEnabled: true, canSeek: true, feedbackEnabled: true });
  engine.loadShow(makeShow());
  engine.play();
  engine.next();
  expect(engine.replayIntro().rejected).toBe('not_allowed');
  expect(engine.setPlaybackMode('manual').rejected).toBe('not_allowed');
  expect(engine.getState().phase).toBe('feedback');
});

it('manual mode with DJ disabled is silent and repeated finish does not advance before feedback', () => {
  const adapter = new FakeAdapter();
  const engine = new PlaybackEngine(adapter, { djEnabled: false, canSeek: true, playbackMode: 'manual', feedbackEnabled: true });
  engine.loadShow(makeShow('TEST-show', 1));
  engine.play();
  expect([engine.getState().phase, adapter.starts.length]).toEqual(['manual_ready', 0]);
  expect(engine.manualFinished().rejected).toBe('not_allowed');
  engine.manualStarted();
  engine.manualFinished();
  expect(engine.manualFinished().rejected).toBe('not_allowed');
  engine.completeFeedback();
  expect(engine.getState().phase).toBe('completed');
});

it('a tuned round ledger failure remains visible in the current show UI warnings', () => {
  const { engine } = setup();
  const state = engine.getState();
  engine.commitTail({ ...makeShow('TEST-tail'), warnings: ['未讀到帳本：本輪只用種子曲。'] }, state.sessionId!, state.queueRevision);
  expect(engine.getState().show?.warnings).toContain('未讀到帳本：本輪只用種子曲。');
});

it('回饋期間拒絕移除接下來，結束回饋後保持正確下一首且可移除', () => {
  const adapter = new FakeAdapter();
  const engine = new PlaybackEngine(adapter, { djEnabled: false, canSeek: true, feedbackEnabled: true });
  engine.loadShow(makeShow());
  engine.play();
  engine.next();
  const before = engine.getState();
  expect(engine.removeUpcoming('showA_2').rejected).toBe('not_allowed');
  expect(engine.getState()).toBe(before);
  engine.completeFeedback();
  expect(engine.getState().queue[engine.getState().currentIndex]?.segment.segmentId).toBe('showA_2');
  expect(engine.removeUpcoming('showA_3').rejected).toBeUndefined();
  expect(engine.getState().queue.map((item) => item.segment.segmentId)).toEqual(['showA_1', 'showA_2', 'showA_4', 'showA_5']);
});

it('輪詢 positionMs 會保存進度，provider 消失後復原仍從最後位置開始', async () => {
  const { adapter, engine } = setup(false);
  engine.play();
  adapter.confirm();
  adapter.getState = () => ({ positionMs: 14_000, durationMs: 30_000, paused: false, ready: true });
  expect(engine.positionMs()).toBe(14_000);
  expect(engine.getState().positionMs).toBe(14_000);
  adapter.getState = () => null;
  engine.deviceLost();
  await flush();
  expect(engine.getState().error?.code).toBe('DEVICE_UNAVAILABLE');
  engine.play();
  expect(adapter.starts.at(-1)).toMatchObject({ owner: 'track', fromMs: 14_000 });
});
