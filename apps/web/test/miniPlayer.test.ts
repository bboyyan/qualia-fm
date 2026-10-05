/**
 * BRA-117 B：迷你播放器與收聽頁回饋態。按鈕永遠做它看起來會做的事：
 * 可播就真的播、在播就真的停；回饋／手動／錯誤時改成「回收聽」，不灰掉假裝可播。
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { initialEngineState, reduce } from '../src/audio/reducer';
import type { EngineState, Phase } from '../src/audio/types';
import { MiniPlayerView, miniAction, miniStatus } from '../src/features/player/MiniPlayerView';
import { ListenArtwork } from '../src/features/player/ListenArtwork';
import { makeShow } from './fixtures';
import { spotifySegment } from './spotifyFakes';

const noop = () => undefined;

function loaded(phase: Phase, overrides: Partial<EngineState> = {}): EngineState {
  const ready = reduce({ ...initialEngineState(true, true), feedbackEnabled: true }, { type: 'LOAD_SHOW', show: makeShow(), sessionId: 'S1' }).state;
  return { ...ready, phase, ...overrides };
}

describe('miniAction：按鈕做它看起來會做的事', () => {
  it.each(['speaking', 'track_playing', 'loading_speech', 'loading_track'] as const)('%s → 暫停', (phase) => {
    expect(miniAction(loaded(phase))).toBe('pause');
  });

  it.each(['ready', 'paused', 'awaiting_gesture', 'completed'] as const)('%s → 播放', (phase) => {
    expect(miniAction(loaded(phase, phase === 'paused' ? { resumePhase: 'track' } : phase === 'awaiting_gesture' ? { pendingOwner: 'track' } : {}))).toBe('play');
  });

  it.each(['feedback', 'manual_ready', 'manual_playing', 'recoverable_error', 'reconciling'] as const)('%s → 回收聽（不是灰掉的播放）', (phase) => {
    expect(miniAction(loaded(phase))).toBe('open');
  });

  it('凡是標成「播放」的狀態，引擎的 PLAY 都真的會改變狀態', () => {
    const cases: EngineState[] = [
      loaded('ready'),
      loaded('paused', { resumePhase: 'track' }),
      loaded('awaiting_gesture', { pendingOwner: 'track' }),
      loaded('completed'),
    ];
    for (const state of cases) {
      const reduction = reduce(state, { type: 'PLAY' });
      expect(reduction.state.phase, state.phase).not.toBe(state.phase);
      expect(reduction.effects.length, state.phase).toBeGreaterThan(0);
    }
  });
});

describe('miniStatus', () => {
  it('回饋時說明要回收聽留下回饋，不是冷冰冰的「等待回饋」', () => {
    const text = miniStatus(loaded('feedback'));
    expect(text).toContain('回饋');
    expect(text).not.toBe('等待回饋');
  });

  it('E 模式播放中顯示 Spotify，不說 MOCK', () => {
    expect(miniStatus(loaded('track_playing', { playbackMode: 'spotify' }))).toContain('Spotify');
  });

  it('AI 語音介紹不標成 MOCK 提示音', () => {
    const show = makeShow();
    const aiShow = { ...show, segments: show.segments.map((s) => ({ ...s, speech: { kind: 'ai_audio' as const, aiVoice: true as const, url: '/api/media/tts/TEST' } })) };
    const state = reduce({ ...initialEngineState(true, true) }, { type: 'LOAD_SHOW', show: aiShow, sessionId: 'S1' }).state;
    expect(miniStatus({ ...state, phase: 'speaking' })).toContain('AI 合成語音');
  });
});

describe('MiniPlayerView', () => {
  const render = (state: EngineState) => renderToStaticMarkup(createElement(MiniPlayerView, { state, onOpen: noop, onPlay: noop, onPause: noop }));

  it('回饋時按鈕是可按的「回收聽」，沒有 disabled', () => {
    const html = render(loaded('feedback'));
    expect(html).toContain('回收聽');
    expect(html).not.toContain('disabled');
  });

  it('播放中顯示暫停；可播時顯示播放，皆可按', () => {
    expect(render(loaded('track_playing'))).toContain('aria-label="暫停"');
    const ready = render(loaded('ready'));
    expect(ready).toContain('aria-label="播放"');
    expect(ready).not.toContain('disabled');
  });
});

describe('收聽頁回饋態保留曲目資訊', () => {
  it('MOCK：回饋時仍顯示聲景圖（不轉動）', () => {
    const state = loaded('feedback');
    const html = renderToStaticMarkup(createElement(ListenArtwork, { state, segment: state.queue[0]!.segment }));
    expect(html).toContain('<figure');
  });

  it('Spotify：回饋時仍顯示封面＋曲名＋在 Spotify 開啟，但不宣稱「已確認有聲音」', () => {
    const segment = spotifySegment();
    const state = loaded('feedback', { playbackMode: 'spotify' });
    const html = renderToStaticMarkup(createElement(ListenArtwork, { state, segment }));
    expect(html).toContain('在 Spotify 開啟');
    expect(html).not.toContain('已確認有聲音');
  });
});
