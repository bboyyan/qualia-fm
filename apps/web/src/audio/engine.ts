/**
 * The app's only playback engine. Owns the reducer state and the single MediaAdapter; React
 * subscribes and dispatches commands but never touches audio directly (AGENTS.md rule 6).
 * Commands run synchronously so `start` → `audio.play()` stays inside the user's tap.
 */
import type { ShowPlan } from '@qualia/contracts';
import { initialEngineState, reduce } from './reducer';
import type { Action, AdapterEvent, Effect, EngineState, MediaAdapter, QueueItem, Reduction } from './types';

export interface EngineOptions {
  playbackMode?: 'manual' | 'mock';
  feedbackEnabled?: boolean;
  djEnabled: boolean;
  canSeek: boolean;
  onAnnounce?: (message: string) => void;
}

function toAction(event: AdapterEvent): Action {
  switch (event.type) {
    case 'started':
      return { type: 'OWNER_STARTED', attemptId: event.attemptId, owner: event.owner };
    case 'ended':
      return { type: 'OWNER_ENDED', attemptId: event.attemptId, owner: event.owner };
    case 'paused':
      return { type: 'OWNER_PAUSED', attemptId: event.attemptId, owner: event.owner, positionMs: event.positionMs };
    case 'failed':
      return { type: 'OWNER_FAILED', attemptId: event.attemptId, owner: event.owner, code: event.code };
  }
}

/** NotAllowedError → needs a tap; AbortError → superseded by our own pause/stop (not a failure). */
export function classifyPlayError(error: unknown): 'AUTOPLAY_BLOCKED' | 'AUDIO_SOURCE_FAILED' | 'ignore' {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'NotAllowedError') return 'AUTOPLAY_BLOCKED';
  if (name === 'AbortError') return 'ignore';
  return 'AUDIO_SOURCE_FAILED';
}

let sessionCounter = 0;

export class PlaybackEngine {
  private state: EngineState;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly adapter: MediaAdapter,
    private readonly options: EngineOptions,
  ) {
    this.state = { ...initialEngineState(options.djEnabled, options.canSeek), playbackMode: options.playbackMode ?? 'mock', feedbackEnabled: options.feedbackEnabled ?? false };
    this.unsubscribe = adapter.subscribe((event) => this.dispatch(toAction(event)));
  }

  getState = (): EngineState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispatch(action: Action): Reduction {
    const reduction = reduce(this.state, action);
    if (reduction.state !== this.state) {
      this.state = reduction.state;
      this.notify();
    }
    this.run(reduction.effects);
    return reduction;
  }

  /** Live provider position while audible; otherwise the last confirmed position. */
  positionMs(): number {
    const live = this.state.phase === 'speaking' || this.state.phase === 'track_playing' ? this.adapter.getState() : null;
    return live ? live.positionMs : this.state.positionMs;
  }

  loadShow(show: ShowPlan): string {
    sessionCounter += 1;
    const sessionId = `ss_${Date.now().toString(36)}_${sessionCounter}`;
    this.dispatch({ type: 'LOAD_SHOW', show, sessionId });
    return sessionId;
  }

  setPlaybackMode = (mode: 'manual' | 'mock'): Reduction => this.dispatch({ type: 'SET_MODE', mode });
  manualStarted = (): Reduction => this.dispatch({ type: 'MANUAL_STARTED' });
  manualFinished = (): Reduction => this.dispatch({ type: 'MANUAL_FINISHED' });
  completeFeedback = (): Reduction => this.dispatch({ type: 'COMPLETE_FEEDBACK' });
  play = (): Reduction => this.dispatch({ type: 'PLAY' });
  /** Captures the live provider position so the paused UI never flashes a stale value. */
  pause = (): Reduction => this.dispatch({ type: 'PAUSE', positionMs: this.positionMs() });
  toggle = (): Reduction => (isAudible(this.state) ? this.pause() : this.play());
  next = (): Reduction => this.dispatch({ type: 'NEXT' });
  jump = (segmentId: string): Reduction => this.dispatch({ type: 'JUMP', segmentId });
  skipIntro = (): Reduction => this.dispatch({ type: 'SKIP_INTRO' });
  restartTrack = (): Reduction => this.dispatch({ type: 'RESTART_TRACK' });
  replayIntro = (): Reduction => this.dispatch({ type: 'REPLAY_INTRO', trackPositionMs: this.positionMs() });
  seek = (positionMs: number): Reduction => this.dispatch({ type: 'SEEK', positionMs });
  setDjEnabled = (enabled: boolean): Reduction => this.dispatch({ type: 'SET_DJ', enabled });
  reconcile = (): Reduction => this.dispatch({ type: 'RECONCILE' });
  deviceLost = (): Reduction => this.dispatch({ type: 'DEVICE_LOST' });
  reset = (): Reduction => this.dispatch({ type: 'RESET' });

  removeUpcoming(segmentId: string): Reduction {
    return this.dispatch({ type: 'REMOVE_UPCOMING', segmentId, expectedRevision: this.state.queueRevision });
  }

  restoreRemoved(expectedRevision: number): Reduction {
    return this.dispatch({ type: 'RESTORE_REMOVED', expectedRevision });
  }

  commitTail(show: ShowPlan, sessionId: string, expectedRevision: number): Reduction {
    const items: QueueItem[] = show.segments.map((segment) => ({ segment, showId: show.showId }));
    return this.dispatch({ type: 'COMMIT_TAIL', items, sessionId, expectedRevision, warnings: show.warnings });
  }

  destroy(): void {
    this.unsubscribe();
    this.adapter.destroy();
    this.listeners.clear();
  }

  private run(effects: readonly Effect[]): void {
    for (const effect of effects) this.runOne(effect);
  }

  private runOne(effect: Effect): void {
    switch (effect.type) {
      case 'start':
        this.watch(this.adapter.start(effect), effect.attemptId, effect.owner);
        return;
      case 'resume': {
        const owner = this.state.activeOwner === 'none' ? 'track' : this.state.activeOwner;
        this.watch(this.adapter.resume(effect.attemptId), effect.attemptId, owner);
        return;
      }
      case 'pause':
        this.adapter.pause();
        return;
      case 'seek':
        this.adapter.seek(effect.positionMs);
        return;
      case 'stop':
        this.adapter.stop();
        return;
      case 'reconcile':
        queueMicrotask(() => this.dispatch({ type: 'RECONCILE_RESULT', state: this.adapter.getState() }));
        return;
      case 'announce':
        this.options.onAnnounce?.(effect.message);
        return;
    }
  }

  /** A rejected play promise becomes an explicit event; no hidden retry loop (AC24). */
  private watch(promise: Promise<void>, attemptId: number, owner: 'speech' | 'track'): void {
    promise.catch((error: unknown) => {
      const code = classifyPlayError(error);
      if (code !== 'ignore') this.dispatch({ type: 'OWNER_FAILED', attemptId, owner, code });
    });
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export function isAudible(state: EngineState): boolean {
  return state.phase === 'speaking' || state.phase === 'track_playing' || state.phase === 'loading_speech' || state.phase === 'loading_track';
}
