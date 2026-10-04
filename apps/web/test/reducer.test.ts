import { describe, expect, it } from 'vitest';
import { initialEngineState, MAX_AUTO_SKIPS, reduce } from '../src/audio/reducer';
import { bridgeAt, currentBridge } from '../src/audio/queue';
import type { Action, EngineState, Reduction } from '../src/audio/types';
import { makeShow } from './fixtures';

function run(actions: Action[], start: EngineState = initialEngineState()): Reduction {
  let reduction: Reduction = { state: start, effects: [] };
  for (const action of actions) reduction = reduce(reduction.state, action);
  return reduction;
}

const load = (speech = true, count = 5): Action => ({ type: 'LOAD_SHOW', show: makeShow('showA', count, speech), sessionId: 'S1' });

/** Simulates the adapter confirming whatever the last start effect requested. */
function confirm(state: EngineState): Action {
  return { type: 'OWNER_STARTED', attemptId: state.attemptId, owner: state.activeOwner === 'speech' ? 'speech' : 'track' };
}

function playing(speech = true): EngineState {
  const started = run([load(speech), { type: 'PLAY' }]).state;
  return reduce(started, confirm(started)).state;
}

function trackPlaying(): EngineState {
  const s = playing();
  const afterSpeech = reduce(s, { type: 'OWNER_ENDED', attemptId: s.attemptId, owner: 'speech' }).state;
  return reduce(afterSpeech, confirm(afterSpeech)).state;
}

describe('load and start', () => {
  it('loads a show as ready without any start effect (AC10)', () => {
    const r = run([load()]);
    expect([r.state.phase, r.effects.some((e) => e.type === 'start')]).toEqual(['ready', false]);
  });

  it('loads a zero-track show as empty', () => {
    expect(run([load(true, 0)]).state.phase).toBe('empty');
  });

  it('PLAY from ready starts the DJ intro first when speech exists', () => {
    const r = run([load(), { type: 'PLAY' }]);
    expect([r.state.phase, r.effects[0]]).toMatchObject(['loading_speech', { type: 'start', owner: 'speech' }]);
  });

  it('PLAY goes straight to the track when DJ is disabled', () => {
    const r = run([load(), { type: 'SET_DJ', enabled: false }, { type: 'PLAY' }]);
    expect(r.state.phase).toBe('loading_track');
  });

  it('becomes speaking only when the adapter confirms playback', () => {
    expect(playing().phase).toBe('speaking');
  });
});

describe('speech and track phases', () => {
  it('speech end starts the same segment track, not the next one', () => {
    const s = playing();
    const r = reduce(s, { type: 'OWNER_ENDED', attemptId: s.attemptId, owner: 'speech' });
    expect([r.state.phase, r.state.currentIndex]).toEqual(['loading_track', 0]);
  });

  it('SKIP_INTRO keeps the same segment and starts its track (AC12)', () => {
    const r = reduce(playing(), { type: 'SKIP_INTRO' });
    expect([r.state.currentIndex, r.effects[0]]).toMatchObject([0, { type: 'start', owner: 'track', fromMs: 0 }]);
  });

  it('pausing speech keeps resumePhase=speech and resumes without restarting (AC11)', () => {
    const paused = reduce(playing(), { type: 'PAUSE' }).state;
    const resumed = reduce(paused, { type: 'PLAY' });
    expect([paused.resumePhase, resumed.effects[0]?.type]).toEqual(['speech', 'resume']);
  });

  it('pause records the provider position captured at the tap', () => {
    expect(reduce(trackPlaying(), { type: 'PAUSE', positionMs: 7_400 }).state.positionMs).toBe(7_400);
  });

  it('resuming a paused track never re-plays the intro (AC14)', () => {
    const paused = reduce(trackPlaying(), { type: 'PAUSE' }).state;
    const r = reduce(paused, { type: 'PLAY' });
    expect([r.state.phase, r.effects.map((e) => e.type)]).toEqual(['loading_track', ['resume']]);
  });

  it('RESTART_TRACK restarts the track at 0 without speech (AC15)', () => {
    const r = reduce(trackPlaying(), { type: 'RESTART_TRACK' });
    expect(r.effects[0]).toMatchObject({ type: 'start', owner: 'track', fromMs: 0 });
  });

  it('RESTART_TRACK is ignored during the intro', () => {
    const s = playing();
    expect(reduce(s, { type: 'RESTART_TRACK' }).state).toBe(s);
  });

  it('disabling DJ during the intro jumps to the track of the same segment', () => {
    const r = reduce(playing(), { type: 'SET_DJ', enabled: false });
    expect([r.state.phase, r.state.currentIndex]).toEqual(['loading_track', 0]);
  });

  it('REPLAY_INTRO resumes the track where it was after the intro', () => {
    const replay = reduce(trackPlaying(), { type: 'REPLAY_INTRO', trackPositionMs: 12_000 }).state;
    const afterSpeech = reduce(replay, { type: 'OWNER_ENDED', attemptId: replay.attemptId, owner: 'speech' });
    expect(afterSpeech.effects[0]).toMatchObject({ type: 'start', owner: 'track', fromMs: 12_000 });
  });
});

describe('stale events and natural end', () => {
  it('drops events from a superseded attempt (AC13)', () => {
    const s = playing();
    const old = s.attemptId;
    const moved = reduce(s, { type: 'NEXT' }).state;
    const r = reduce(moved, { type: 'OWNER_ENDED', attemptId: old, owner: 'speech' });
    expect(r.state).toBe(moved);
  });

  it('advances exactly once on duplicate ended events (AC18)', () => {
    const s = trackPlaying();
    const first = reduce(s, { type: 'OWNER_ENDED', attemptId: s.attemptId, owner: 'track' }).state;
    const second = reduce(first, { type: 'OWNER_ENDED', attemptId: s.attemptId, owner: 'track' }).state;
    expect([first.currentIndex, second.currentIndex]).toEqual([1, 1]);
  });

  it('completes after the last track instead of looping or generating more', () => {
    let s = run([load(false, 1), { type: 'PLAY' }]).state;
    s = reduce(s, confirm(s)).state;
    const r = reduce(s, { type: 'OWNER_ENDED', attemptId: s.attemptId, owner: 'track' });
    expect([r.state.phase, r.effects.map((e) => e.type)]).toEqual(['completed', ['stop', 'announce']]);
  });

  it('ignores the pause that precedes a natural end of a different attempt', () => {
    const s = trackPlaying();
    const r = reduce(s, { type: 'OWNER_PAUSED', attemptId: s.attemptId - 1, owner: 'track', positionMs: 1 });
    expect(r.state).toBe(s);
  });
});

describe('failures and recovery', () => {
  it('autoplay rejection waits for a gesture and keeps segment and phase (AC24)', () => {
    const s = run([load(), { type: 'PLAY' }]).state;
    const r = reduce(s, { type: 'OWNER_FAILED', attemptId: s.attemptId, owner: 'speech', code: 'AUTOPLAY_BLOCKED' });
    expect([r.state.phase, r.state.pendingOwner, r.state.currentIndex, r.effects.some((e) => e.type === 'start')]).toEqual([
      'awaiting_gesture',
      'speech',
      0,
      false,
    ]);
  });

  it('the resume gesture restarts the pending owner once', () => {
    const s = run([load(), { type: 'PLAY' }]).state;
    const blocked = reduce(s, { type: 'OWNER_FAILED', attemptId: s.attemptId, owner: 'speech', code: 'AUTOPLAY_BLOCKED' }).state;
    expect(reduce(blocked, { type: 'PLAY' }).effects.filter((e) => e.type === 'start')).toHaveLength(1);
  });

  it('a failed intro falls back to the track (TTS failure never blocks music, AC17)', () => {
    const s = playing();
    const r = reduce(s, { type: 'OWNER_FAILED', attemptId: s.attemptId, owner: 'speech', code: 'AUDIO_SOURCE_FAILED' });
    expect(r.effects[0]).toMatchObject({ type: 'start', owner: 'track' });
  });

  it(`auto-skips at most ${MAX_AUTO_SKIPS} failing tracks, then stops (AC19)`, () => {
    let s = run([load(false), { type: 'PLAY' }]).state;
    for (let i = 0; i < MAX_AUTO_SKIPS + 1; i += 1) {
      s = reduce(s, { type: 'OWNER_FAILED', attemptId: s.attemptId, owner: 'track', code: 'AUDIO_SOURCE_FAILED' }).state;
    }
    expect([s.phase, s.currentIndex, s.error?.code]).toEqual(['recoverable_error', 2, 'AUDIO_SOURCE_FAILED']);
  });

  it('device loss reconciles and becomes a recoverable error when the device is gone (AC25)', () => {
    const lost = reduce(trackPlaying(), { type: 'DEVICE_LOST' });
    const r = reduce(lost.state, { type: 'RECONCILE_RESULT', state: null });
    expect([lost.effects[0]?.type, r.state.phase, r.state.error?.code]).toEqual(['reconcile', 'recoverable_error', 'DEVICE_UNAVAILABLE']);
  });

  it('reconcile trusts a verified paused provider state', () => {
    const lost = reduce(trackPlaying(), { type: 'RECONCILE' }).state;
    const r = reduce(lost, { type: 'RECONCILE_RESULT', state: { positionMs: 4_000, durationMs: 30_000, paused: true, ready: true } });
    expect([r.state.phase, r.state.resumePhase, r.state.positionMs]).toEqual(['paused', 'track', 4_000]);
  });
});

describe('seek', () => {
  it('clamps to the track duration (AC16)', () => {
    const r = reduce(trackPlaying(), { type: 'SEEK', positionMs: 999_999 });
    expect(r.effects[0]).toEqual({ type: 'seek', positionMs: 30_000 });
  });

  it('is refused during the intro', () => {
    expect(reduce(playing(), { type: 'SEEK', positionMs: 1_000 }).rejected).toBe('not_allowed');
  });
});

describe('queue mutations', () => {
  it('removes only upcoming segments and bumps queueRevision (AC20)', () => {
    const s = trackPlaying();
    const r = reduce(s, { type: 'REMOVE_UPCOMING', segmentId: 'showA_3', expectedRevision: 0 });
    expect([r.state.queue.length, r.state.queueRevision, r.state.removed?.index]).toEqual([4, 1, 2]);
  });

  it('refuses to remove the current segment', () => {
    expect(reduce(trackPlaying(), { type: 'REMOVE_UPCOMING', segmentId: 'showA_1', expectedRevision: 0 }).rejected).toBe('not_upcoming');
  });

  it('rejects a stale revision', () => {
    expect(reduce(trackPlaying(), { type: 'REMOVE_UPCOMING', segmentId: 'showA_3', expectedRevision: 7 }).rejected).toBe('stale_revision');
  });

  it('restores a removed segment to its original position', () => {
    const removed = reduce(trackPlaying(), { type: 'REMOVE_UPCOMING', segmentId: 'showA_3', expectedRevision: 0 }).state;
    const r = reduce(removed, { type: 'RESTORE_REMOVED', expectedRevision: 1 });
    expect(r.state.queue.map((q) => q.segment.segmentId)).toEqual(['showA_1', 'showA_2', 'showA_3', 'showA_4', 'showA_5']);
  });

  it('commits a new tail after the current segment without touching playback (AC22)', () => {
    const s = trackPlaying();
    const tail = makeShow('showB', 2).segments.map((segment) => ({ segment, showId: 'showB' }));
    const r = reduce(s, { type: 'COMMIT_TAIL', items: tail, sessionId: 'S1', expectedRevision: 0 });
    expect([r.state.queue.map((q) => q.segment.segmentId), r.effects.some((e) => e.type === 'start' || e.type === 'stop'), r.state.attemptId]).toEqual([
      ['showA_1', 'showB_1', 'showB_2'],
      false,
      s.attemptId,
    ]);
  });

  it('refuses a tail for another session', () => {
    const r = reduce(trackPlaying(), { type: 'COMMIT_TAIL', items: [], sessionId: 'OTHER', expectedRevision: 0 });
    expect(r.rejected).toBe('stale_session');
  });
});

describe('bridge adjacency (AC21)', () => {
  it('shows the transition bridge after the previous track ends naturally', () => {
    const s = trackPlaying();
    const next = reduce(s, { type: 'OWNER_ENDED', attemptId: s.attemptId, owner: 'track' }).state;
    expect(currentBridge(next)).toMatchObject({ kind: 'transition', fromTitle: '曲目1' });
  });

  it('falls back to the seed bridge when the previous track was skipped', () => {
    const next = reduce(trackPlaying(), { type: 'NEXT' }).state;
    expect(currentBridge(next)?.kind).toBe('seed');
  });

  it('falls back to the seed bridge for an upcoming row whose predecessor was removed', () => {
    const removed = reduce(trackPlaying(), { type: 'REMOVE_UPCOMING', segmentId: 'showA_2', expectedRevision: 0 }).state;
    expect(bridgeAt(removed, 1)?.kind).toBe('seed');
  });

  it('never matches a transition across different shows', () => {
    const s = trackPlaying();
    const tail = makeShow('showB', 3).segments.slice(1).map((segment) => ({ segment, showId: 'showB' }));
    const committed = reduce(s, { type: 'COMMIT_TAIL', items: tail, sessionId: 'S1', expectedRevision: 0 }).state;
    expect(bridgeAt(committed, 1)?.kind).toBe('seed');
  });
});
