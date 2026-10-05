/**
 * BRA-117 B：回饋時機。引言結束絕不直接進回饋；回饋只在曲目真的播過之後，
 * 由使用者明確結束／跳過，或曲目自然結束時出現。
 */
import { describe, expect, it } from 'vitest';
import { initialEngineState, reduce } from '../src/audio/reducer';
import type { Action, EngineState, PlaybackMode, Reduction } from '../src/audio/types';
import { makeShow } from './fixtures';

function run(actions: Action[], start: EngineState): Reduction {
  let reduction: Reduction = { state: start, effects: [] };
  for (const action of actions) reduction = reduce(reduction.state, action);
  return reduction;
}

function base(mode: PlaybackMode): EngineState {
  return { ...initialEngineState(true, true), playbackMode: mode, feedbackEnabled: true };
}

const load: Action = { type: 'LOAD_SHOW', show: makeShow('showA', 5, true), sessionId: 'S1' };
const started = (state: EngineState, owner: 'speech' | 'track'): Action => ({ type: 'OWNER_STARTED', attemptId: state.attemptId, owner });
const ended = (state: EngineState, owner: 'speech' | 'track'): Action => ({ type: 'OWNER_ENDED', attemptId: state.attemptId, owner });

/** 介紹正在念。 */
function speaking(mode: PlaybackMode): EngineState {
  const s = run([load, { type: 'PLAY' }], base(mode)).state;
  return reduce(s, started(s, 'speech')).state;
}

/** 介紹念完，曲目已送出但還沒確認在播。 */
function trackLoading(mode: PlaybackMode): EngineState {
  const s = speaking(mode);
  return reduce(s, ended(s, 'speech')).state;
}

/** 曲目已確認在播。 */
function trackHeard(mode: PlaybackMode): EngineState {
  const s = trackLoading(mode);
  return reduce(s, started(s, 'track')).state;
}

describe('引言結束不會進回饋', () => {
  it.each(['mock', 'spotify'] as const)('%s：介紹念完 → 自動嘗試播同一首曲目，不是回饋', (mode) => {
    const reduction = reduce(speaking(mode), ended(speaking(mode), 'speech'));
    expect(reduction.state.phase).toBe('loading_track');
    expect(reduction.state.currentIndex).toBe(0);
    expect(reduction.effects).toContainEqual(expect.objectContaining({ type: 'start', owner: 'track' }));
  });

  it('B 手動：介紹念完 → 等你在 Spotify 點歌，不是回饋', () => {
    const s = speaking('manual');
    expect(reduce(s, ended(s, 'speech')).state.phase).toBe('manual_ready');
  });

  it('曲目送出後尚未確認在播，不算聽過', () => {
    expect(trackLoading('spotify').trackHeard).toBe(false);
    expect(trackHeard('spotify').trackHeard).toBe(true);
  });
});

describe('沒聽到曲目就按下一首：直接往下，不問回饋', () => {
  it.each(['mock', 'spotify', 'manual'] as const)('%s：介紹中按下一首 → 第 2 首開始，第 1 首記為略過', (mode) => {
    const reduction = reduce(speaking(mode), { type: 'NEXT' });
    expect(reduction.state.phase).not.toBe('feedback');
    expect(reduction.state.currentIndex).toBe(1);
    expect(reduction.state.statuses.showA_1).toBe('skipped');
  });

  it('曲目還在載入就按下一首 → 不問回饋', () => {
    expect(reduce(trackLoading('spotify'), { type: 'NEXT' }).state.phase).not.toBe('feedback');
  });

  it('B 手動：還沒按「我開始播了」就跳過 → 不問回饋', () => {
    const s = trackLoading('manual');
    expect(s.phase).toBe('manual_ready');
    const next = reduce(s, { type: 'NEXT' }).state;
    expect(next.phase).not.toBe('feedback');
    expect(next.currentIndex).toBe(1);
  });

  it('從節目單跳到別首也一樣：沒聽到就不問回饋', () => {
    expect(reduce(speaking('mock'), { type: 'JUMP', segmentId: 'showA_3' }).state.currentIndex).toBe(2);
  });

  it('跳到下一首後，新的一首重新從「沒聽過」開始', () => {
    const next = reduce(trackHeard('mock'), { type: 'NEXT' }).state;
    const after = reduce(next, { type: 'COMPLETE_FEEDBACK' }).state;
    expect(after.trackHeard).toBe(false);
  });
});

describe('聽過之後才問回饋', () => {
  it('R1：載曲中裝置中斷，reconcile 確認在播後，下一首先問目前這首的回饋', () => {
    const loading = run([load, { type: 'PLAY' }], { ...base('spotify'), djEnabled: false }).state;
    expect(loading.phase).toBe('loading_track');
    const lost = reduce(loading, { type: 'DEVICE_LOST' }).state;
    const lateStart = reduce(lost, started(lost, 'track')).state;
    expect(lateStart.phase).toBe('reconciling');
    expect(lateStart.trackHeard).toBe(false);
    const reconciled = reduce(lateStart, { type: 'RECONCILE_RESULT', state: { ready: true, paused: false, positionMs: 5_000, durationMs: 30_000 } }).state;
    expect(reconciled.phase).toBe('track_playing');
    expect(reconciled.trackHeard).toBe(true);
    const next = reduce(reconciled, { type: 'NEXT' }).state;
    expect(next.phase).toBe('feedback');
    expect(next.currentIndex).toBe(0);
  });

  it('介紹載入中裝置中斷，reconcile 確認介紹在播仍不算聽過曲目', () => {
    const loading = run([load, { type: 'PLAY' }], base('spotify')).state;
    const lost = reduce(loading, { type: 'DEVICE_LOST' }).state;
    const lateStart = reduce(lost, started(lost, 'speech')).state;
    const reconciled = reduce(lateStart, { type: 'RECONCILE_RESULT', state: { ready: true, paused: false, positionMs: 1_000, durationMs: 2_000 } }).state;
    expect(reconciled.phase).toBe('speaking');
    expect(reconciled.trackHeard).toBe(false);
    const next = reduce(reconciled, { type: 'NEXT' }).state;
    expect(next.phase).not.toBe('feedback');
    expect(next.currentIndex).toBe(1);
  });

  it.each(['mock', 'spotify'] as const)('%s：曲目播放中按下一首 → 回饋', (mode) => {
    const reduction = reduce(trackHeard(mode), { type: 'NEXT' });
    expect(reduction.state.phase).toBe('feedback');
    expect(reduction.state.feedbackNextIndex).toBe(1);
  });

  it('曲目暫停中按下一首 → 回饋（已經聽過）', () => {
    const paused = reduce(trackHeard('mock'), { type: 'PAUSE', positionMs: 5_000 }).state;
    expect(reduce(paused, { type: 'NEXT' }).state.phase).toBe('feedback');
  });

  it('自然播完 → 回饋', () => {
    const s = trackHeard('spotify');
    expect(reduce(s, ended(s, 'track')).state.phase).toBe('feedback');
  });

  it('聽過後重聽介紹再按下一首 → 仍然問回饋', () => {
    const s = trackHeard('mock');
    const replay = reduce(s, { type: 'REPLAY_INTRO', trackPositionMs: 3_000 }).state;
    expect(reduce(replay, { type: 'NEXT' }).state.phase).toBe('feedback');
  });

  it('B 手動：按了「我開始播了」再跳過 → 回饋', () => {
    const playingManual = reduce(trackLoading('manual'), { type: 'MANUAL_STARTED' }).state;
    expect(playingManual.trackHeard).toBe(true);
    expect(reduce(playingManual, { type: 'NEXT' }).state.phase).toBe('feedback');
  });
});

describe('E 模式：介紹後自動播失敗 → 停在「點一下繼續」', () => {
  const failed = (state: EngineState, code: 'AUTOPLAY_BLOCKED' | 'AUDIO_SOURCE_FAILED'): Action => ({ type: 'OWNER_FAILED', attemptId: state.attemptId, owner: 'track', code });

  it('瀏覽器擋自動播放 → 點一下繼續，留在同一首', () => {
    const s = trackLoading('spotify');
    const next = reduce(s, failed(s, 'AUTOPLAY_BLOCKED')).state;
    expect(next.phase).toBe('awaiting_gesture');
    expect(next.pendingOwner).toBe('track');
    expect(next.currentIndex).toBe(0);
  });

  it('Spotify 起播失敗也不自動跳下一首：停在點一下繼續，點了只重試這首曲目', () => {
    const s = trackLoading('spotify');
    const waiting = reduce(s, failed(s, 'AUDIO_SOURCE_FAILED'));
    expect(waiting.state.phase).toBe('awaiting_gesture');
    expect(waiting.state.currentIndex).toBe(0);
    expect(waiting.state.statuses.showA_1).toBe('playing');
    const retry = reduce(waiting.state, { type: 'PLAY' });
    expect(retry.effects).toContainEqual(expect.objectContaining({ type: 'start', owner: 'track' }));
    expect(retry.state.currentIndex).toBe(0);
  });

  it('點一下後仍失敗 → 停在可恢復錯誤（同一首），不無限重試、不跳歌', () => {
    const s = trackLoading('spotify');
    const waiting = reduce(s, failed(s, 'AUDIO_SOURCE_FAILED')).state;
    const retry = reduce(waiting, { type: 'PLAY' }).state;
    const again = reduce(retry, failed(retry, 'AUDIO_SOURCE_FAILED')).state;
    expect(again.phase).toBe('recoverable_error');
    expect(again.currentIndex).toBe(0);
  });

  it('MOCK 模式維持原本的自動略過（AC19 不變）', () => {
    const s = trackLoading('mock');
    expect(reduce(s, failed(s, 'AUDIO_SOURCE_FAILED')).state.currentIndex).toBe(1);
  });
});
