/**
 * Pure playback state machine (docs/06 transition table). Returns the next state plus effects
 * for the engine to run against the single adapter. Every adapter event carries the attemptId
 * it belongs to; anything stale is dropped, so late results can never change playback.
 */
import { ERROR_MESSAGES } from '@qualia/contracts';
import type { Action, Effect, EngineState, OwnerKind, Phase, QueueItem, Reduction, Rejection, SegmentStatus } from './types';

export const MAX_AUTO_SKIPS = 2;

export const initialEngineState = (djEnabled = true, canSeek = true): EngineState => ({
  sessionId: null,
  show: null,
  queue: [],
  statuses: {},
  currentIndex: -1,
  phase: 'empty',
  resumePhase: null,
  pendingOwner: null,
  activeOwner: 'none',
  attemptId: 0,
  queueRevision: 0,
  positionMs: 0,
  trackResumeMs: 0,
  djEnabled,
  canSeek,
  consecutiveFailures: 0,
  error: null,
  removed: null,
  previousPlayedId: null,
});

const ACTIVE: ReadonlySet<Phase> = new Set(['loading_speech', 'speaking', 'loading_track', 'track_playing']);
const LOADING: Record<OwnerKind, Phase> = { speech: 'loading_speech', track: 'loading_track' };
const PLAYING: Record<OwnerKind, Phase> = { speech: 'speaking', track: 'track_playing' };

const ok = (state: EngineState, effects: Effect[] = []): Reduction => ({ state, effects });
const reject = (state: EngineState, rejected: Rejection): Reduction => ({ state, effects: [], rejected });
const announce = (message: string): Effect => ({ type: 'announce', message });

const withStatus = (state: EngineState, index: number, status: SegmentStatus): Readonly<Record<string, SegmentStatus>> => {
  const item = state.queue[index];
  return item ? { ...state.statuses, [item.segment.segmentId]: status } : state.statuses;
};

/** Marks the current segment as skipped when it is left before finishing. */
function leaveCurrent(state: EngineState): EngineState {
  const item = state.queue[state.currentIndex];
  if (!item || state.statuses[item.segment.segmentId] !== 'playing') return state;
  return { ...state, statuses: withStatus(state, state.currentIndex, 'skipped'), previousPlayedId: null };
}

function startSegment(state: EngineState, index: number): Reduction {
  const item = state.queue[index];
  if (!item) return complete(state);
  const attemptId = state.attemptId + 1;
  const owner: OwnerKind = state.djEnabled && item.segment.speech.kind !== 'none' ? 'speech' : 'track';
  const next: EngineState = {
    ...state,
    currentIndex: index,
    attemptId,
    phase: LOADING[owner],
    activeOwner: owner,
    resumePhase: null,
    pendingOwner: null,
    positionMs: 0,
    trackResumeMs: 0,
    error: null,
    statuses: withStatus({ ...state, currentIndex: index }, index, 'playing'),
  };
  return ok(next, [
    { type: 'start', owner, segment: item.segment, fromMs: 0, attemptId },
    announce(`${owner === 'speech' ? 'DJ 介紹：' : '現在播放：'}${item.segment.candidate.title}`),
  ]);
}

function startTrack(state: EngineState, fromMs: number): Reduction {
  const item = state.queue[state.currentIndex];
  if (!item) return ok(state);
  const attemptId = state.attemptId + 1;
  return ok(
    { ...state, attemptId, phase: 'loading_track', activeOwner: 'track', resumePhase: null, pendingOwner: null, positionMs: fromMs, trackResumeMs: 0, error: null },
    [{ type: 'start', owner: 'track', segment: item.segment, fromMs, attemptId }],
  );
}

function restartPending(state: EngineState): Reduction {
  const item = state.queue[state.currentIndex];
  if (!item) return ok(state);
  const owner = state.pendingOwner ?? 'track';
  const attemptId = state.attemptId + 1;
  return ok(
    { ...state, attemptId, phase: LOADING[owner], activeOwner: owner, pendingOwner: null, error: null },
    [{ type: 'start', owner, segment: item.segment, fromMs: state.positionMs, attemptId }],
  );
}

function complete(state: EngineState): Reduction {
  return ok(
    { ...state, phase: 'completed', activeOwner: 'none', resumePhase: null, pendingOwner: null, attemptId: state.attemptId + 1, positionMs: 0 },
    [{ type: 'stop' }, announce('這一段節目已結束')],
  );
}

function loadShow(state: EngineState, action: Extract<Action, { type: 'LOAD_SHOW' }>): Reduction {
  const queue: QueueItem[] = action.show.segments.map((segment) => ({ segment, showId: action.show.showId }));
  const statuses = Object.fromEntries(queue.map((q) => [q.segment.segmentId, 'queued' as const]));
  const base = initialEngineState(state.djEnabled, state.canSeek);
  const next: EngineState = {
    ...base,
    sessionId: action.sessionId,
    show: action.show,
    queue,
    statuses,
    currentIndex: queue.length > 0 ? 0 : -1,
    phase: queue.length > 0 ? 'ready' : 'empty',
    attemptId: state.attemptId + 1,
  };
  return ok(next, state.phase === 'empty' ? [] : [{ type: 'stop' }]);
}

function play(state: EngineState): Reduction {
  switch (state.phase) {
    case 'ready':
      return startSegment(state, state.currentIndex);
    case 'completed':
      if (state.currentIndex < state.queue.length - 1) return startSegment(state, state.currentIndex + 1);
      return startSegment({ ...state, statuses: Object.fromEntries(state.queue.map((q) => [q.segment.segmentId, 'queued'])), previousPlayedId: null }, 0);
    case 'paused': {
      const owner = state.resumePhase ?? 'track';
      return ok({ ...state, phase: LOADING[owner], activeOwner: owner, resumePhase: null }, [{ type: 'resume', attemptId: state.attemptId }]);
    }
    case 'awaiting_gesture':
    case 'recoverable_error':
      return restartPending(state);
    default:
      return ok(state);
  }
}

function pause(state: EngineState, positionMs: number | undefined): Reduction {
  if (!ACTIVE.has(state.phase) || state.activeOwner === 'none') return ok(state);
  return ok({ ...state, phase: 'paused', resumePhase: state.activeOwner, positionMs: positionMs ?? state.positionMs }, [{ type: 'pause' }]);
}

function next(state: EngineState): Reduction {
  if (state.queue.length === 0) return ok(state);
  const left = leaveCurrent(state);
  if (state.currentIndex >= state.queue.length - 1) return complete(left);
  return startSegment({ ...left, previousPlayedId: null, consecutiveFailures: 0 }, state.currentIndex + 1);
}

function jump(state: EngineState, segmentId: string): Reduction {
  const index = state.queue.findIndex((q) => q.segment.segmentId === segmentId);
  if (index < 0) return reject(state, 'not_allowed');
  if (index === state.currentIndex && state.phase !== 'ready' && state.phase !== 'completed') return ok(state);
  return startSegment({ ...leaveCurrent(state), previousPlayedId: null, consecutiveFailures: 0 }, index);
}

function inSpeech(state: EngineState): boolean {
  return (
    state.phase === 'speaking' ||
    state.phase === 'loading_speech' ||
    (state.phase === 'paused' && state.resumePhase === 'speech') ||
    (state.phase === 'awaiting_gesture' && state.pendingOwner === 'speech')
  );
}

function inTrack(state: EngineState): boolean {
  return (
    state.phase === 'track_playing' ||
    state.phase === 'loading_track' ||
    (state.phase === 'paused' && state.resumePhase === 'track') ||
    ((state.phase === 'recoverable_error' || state.phase === 'awaiting_gesture') && state.pendingOwner === 'track')
  );
}

function seek(state: EngineState, positionMs: number): Reduction {
  const seekable = state.phase === 'track_playing' || (state.phase === 'paused' && state.resumePhase === 'track');
  if (!state.canSeek || !seekable) return reject(state, 'not_allowed');
  const duration = state.queue[state.currentIndex]?.segment.track.durationMs ?? Number.POSITIVE_INFINITY;
  const clamped = Math.max(0, Math.min(Math.round(positionMs), duration));
  return ok({ ...state, positionMs: clamped }, [{ type: 'seek', positionMs: clamped }]);
}

function replayIntro(state: EngineState, trackPositionMs: number): Reduction {
  const item = state.queue[state.currentIndex];
  if (!item || !state.djEnabled || item.segment.speech.kind === 'none' || state.phase === 'ready' || state.phase === 'completed') {
    return reject(state, 'not_allowed');
  }
  const attemptId = state.attemptId + 1;
  const resumeAt = inTrack(state) ? Math.max(0, trackPositionMs) : 0;
  return ok(
    { ...state, attemptId, phase: 'loading_speech', activeOwner: 'speech', resumePhase: null, pendingOwner: null, positionMs: 0, trackResumeMs: resumeAt, error: null },
    [{ type: 'start', owner: 'speech', segment: item.segment, fromMs: 0, attemptId }],
  );
}

function removeUpcoming(state: EngineState, segmentId: string, expectedRevision: number): Reduction {
  if (expectedRevision !== state.queueRevision) return reject(state, 'stale_revision');
  const index = state.queue.findIndex((q) => q.segment.segmentId === segmentId);
  if (index <= state.currentIndex) return reject(state, 'not_upcoming');
  const item = state.queue[index];
  if (!item) return reject(state, 'not_upcoming');
  return ok(
    { ...state, queue: state.queue.filter((_, i) => i !== index), removed: { item, index }, queueRevision: state.queueRevision + 1 },
    [announce(`已從接下來移除：${item.segment.candidate.title}`)],
  );
}

function restoreRemoved(state: EngineState, expectedRevision: number): Reduction {
  if (!state.removed) return reject(state, 'nothing_to_restore');
  if (expectedRevision !== state.queueRevision) return reject(state, 'stale_revision');
  const at = Math.min(Math.max(state.currentIndex + 1, state.removed.index), state.queue.length);
  const queue = [...state.queue.slice(0, at), state.removed.item, ...state.queue.slice(at)];
  return ok({ ...state, queue, removed: null, queueRevision: state.queueRevision + 1 }, [announce('已放回接下來的曲目')]);
}

function commitTail(state: EngineState, action: Extract<Action, { type: 'COMMIT_TAIL' }>): Reduction {
  if (action.sessionId !== state.sessionId) return reject(state, 'stale_session');
  if (action.expectedRevision !== state.queueRevision) return reject(state, 'stale_revision');
  const keep = state.queue.slice(0, state.currentIndex + 1);
  const statuses = { ...state.statuses, ...Object.fromEntries(action.items.map((q) => [q.segment.segmentId, 'queued' as const])) };
  return ok(
    { ...state, queue: [...keep, ...action.items], statuses, removed: null, queueRevision: state.queueRevision + 1 },
    [announce(`已更新接下來的 ${action.items.length} 首，目前這首不中斷`)],
  );
}

function reconcileResult(state: EngineState, provider: Extract<Action, { type: 'RECONCILE_RESULT' }>['state']): Reduction {
  if (state.phase !== 'reconciling') return ok(state);
  const owner = state.activeOwner === 'none' ? 'track' : state.activeOwner;
  if (!provider || !provider.ready) {
    return ok(
      { ...state, phase: 'recoverable_error', pendingOwner: owner, error: { code: 'DEVICE_UNAVAILABLE', message: ERROR_MESSAGES.DEVICE_UNAVAILABLE } },
      [announce('播放裝置目前未連線')],
    );
  }
  if (provider.paused) return ok({ ...state, phase: 'paused', resumePhase: owner, positionMs: provider.positionMs });
  return ok({ ...state, phase: PLAYING[owner], positionMs: provider.positionMs });
}

function ownerStarted(state: EngineState, owner: OwnerKind): Reduction {
  if (state.phase !== LOADING[owner]) return ok(state);
  return ok({ ...state, phase: PLAYING[owner], activeOwner: owner, consecutiveFailures: owner === 'track' ? 0 : state.consecutiveFailures });
}

function ownerPaused(state: EngineState, owner: OwnerKind, positionMs: number): Reduction {
  if (state.phase === PLAYING[owner]) return ok({ ...state, phase: 'paused', resumePhase: owner, positionMs });
  return ok(state.phase === 'paused' ? { ...state, positionMs } : state);
}

/** One natural end advances exactly once: the next attemptId makes duplicates stale. */
function ownerEnded(state: EngineState, owner: OwnerKind): Reduction {
  if (owner === 'speech' && (state.phase === 'speaking' || state.phase === 'loading_speech')) {
    return startTrack(state, state.trackResumeMs);
  }
  if (owner !== 'track' || state.phase !== 'track_playing') return ok(state);
  const item = state.queue[state.currentIndex];
  const played: EngineState = {
    ...state,
    statuses: withStatus(state, state.currentIndex, 'played'),
    previousPlayedId: item?.segment.segmentId ?? null,
  };
  return state.currentIndex < state.queue.length - 1 ? startSegment(played, state.currentIndex + 1) : complete(played);
}

function ownerFailed(state: EngineState, owner: OwnerKind, code: 'AUTOPLAY_BLOCKED' | 'AUDIO_SOURCE_FAILED'): Reduction {
  if (code === 'AUTOPLAY_BLOCKED') {
    return ok(
      { ...state, phase: 'awaiting_gesture', pendingOwner: owner, error: { code, message: ERROR_MESSAGES.AUTOPLAY_BLOCKED } },
      [announce('需要點一下才能繼續播放')],
    );
  }
  if (owner === 'speech') {
    const fallback = startTrack(state, state.trackResumeMs);
    return { ...fallback, effects: [...fallback.effects, announce('介紹暫時無法播放，直接進歌')] };
  }
  const failures = state.consecutiveFailures + 1;
  const failed: EngineState = { ...state, consecutiveFailures: failures, statuses: withStatus(state, state.currentIndex, 'failed'), previousPlayedId: null };
  if (failures <= MAX_AUTO_SKIPS && state.currentIndex < state.queue.length - 1) return startSegment(failed, state.currentIndex + 1);
  return ok(
    { ...failed, phase: 'recoverable_error', pendingOwner: 'track', positionMs: 0, attemptId: state.attemptId + 1, error: { code, message: ERROR_MESSAGES.AUDIO_SOURCE_FAILED } },
    [{ type: 'stop' }, announce('曲目暫時無法播放')],
  );
}

function adapterEvent(state: EngineState, action: Extract<Action, { attemptId: number }>): Reduction {
  if (action.attemptId !== state.attemptId) return ok(state);
  switch (action.type) {
    case 'OWNER_STARTED':
      return ownerStarted(state, action.owner);
    case 'OWNER_PAUSED':
      return ownerPaused(state, action.owner, action.positionMs);
    case 'OWNER_ENDED':
      return ownerEnded(state, action.owner);
    case 'OWNER_FAILED':
      return ownerFailed(state, action.owner, action.code);
  }
}

export function reduce(state: EngineState, action: Action): Reduction {
  switch (action.type) {
    case 'LOAD_SHOW':
      return loadShow(state, action);
    case 'PLAY':
      return play(state);
    case 'PAUSE':
      return pause(state, action.positionMs);
    case 'NEXT':
      return next(state);
    case 'JUMP':
      return jump(state, action.segmentId);
    case 'SKIP_INTRO':
      return inSpeech(state) ? startTrack(state, state.trackResumeMs) : ok(state);
    case 'RESTART_TRACK':
      return inTrack(state) ? startTrack(state, 0) : ok(state);
    case 'REPLAY_INTRO':
      return replayIntro(state, action.trackPositionMs);
    case 'SEEK':
      return seek(state, action.positionMs);
    case 'REMOVE_UPCOMING':
      return removeUpcoming(state, action.segmentId, action.expectedRevision);
    case 'RESTORE_REMOVED':
      return restoreRemoved(state, action.expectedRevision);
    case 'COMMIT_TAIL':
      return commitTail(state, action);
    case 'SET_DJ': {
      const updated = { ...state, djEnabled: action.enabled };
      return !action.enabled && inSpeech(state) ? startTrack(updated, state.trackResumeMs) : ok(updated);
    }
    case 'DEVICE_LOST':
      return ACTIVE.has(state.phase) ? ok({ ...state, phase: 'reconciling' }, [{ type: 'reconcile' }]) : ok(state);
    case 'RECONCILE':
      // Foreground return / pageshow: re-read the provider, but never interrupt a pending start.
      return state.phase === 'speaking' || state.phase === 'track_playing'
        ? ok({ ...state, phase: 'reconciling' }, [{ type: 'reconcile' }])
        : ok(state);
    case 'RECONCILE_RESULT':
      return reconcileResult(state, action.state);
    case 'RESET':
      return ok({ ...initialEngineState(state.djEnabled, state.canSeek), attemptId: state.attemptId + 1 }, [{ type: 'stop' }]);
    default:
      return adapterEvent(state, action);
  }
}
