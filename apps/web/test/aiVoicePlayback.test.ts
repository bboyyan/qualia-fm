import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVIDER_NOTICES, type ShowPlan } from '@qualia/contracts';
import { mockSourceResolver } from '../src/audio/adapters/htmlAudioAdapter';
import { PlaybackEngine } from '../src/audio/engine';
import { initialEngineState, reduce } from '../src/audio/reducer';
import type { AdapterEvent, EngineState, MediaAdapter, StartRequest } from '../src/audio/types';
import { ProviderNotices, SpeechFallbackNotice } from '../src/features/player/ProviderNotices';
import { makeShow } from './fixtures';

beforeEach(() => { vi.stubGlobal('fetch', () => { throw new Error('禁止真實網路'); }); });

const AI_URL = (showId: string, segmentId: string) => `/api/media/tts/${showId}/${segmentId}/${'a'.repeat(64)}`;
function aiShow(): ShowPlan {
  const show = makeShow('showA', 3);
  return { ...show, segments: show.segments.map((s) => ({ ...s, speech: { kind: 'ai_audio', aiVoice: true, url: AI_URL(show.showId, s.segmentId) } })) };
}

function speakingAi(): EngineState {
  let state = reduce(initialEngineState(), { type: 'LOAD_SHOW', show: aiShow(), sessionId: 'S1' }).state;
  state = reduce(state, { type: 'PLAY' }).state;
  return reduce(state, { type: 'OWNER_STARTED', attemptId: state.attemptId, owner: 'speech' }).state;
}

describe('AI 語音播放失敗（例如快取過期 404、網路中斷）', () => {
  it('不阻擋音樂（AC17）但不靜默：直接進曲目並記下本段需顯示文字介紹', () => {
    const s = speakingAi();
    const r = reduce(s, { type: 'OWNER_FAILED', attemptId: s.attemptId, owner: 'speech', code: 'AUDIO_SOURCE_FAILED' });
    expect(r.effects[0]).toMatchObject({ type: 'start', owner: 'track' });
    expect(r.state.speechFallbackId).toBe(s.queue[0]!.segment.segmentId);
    expect(r.effects).toContainEqual({ type: 'announce', message: expect.stringContaining('文字介紹') });
  });

  it('換到下一段或重播介紹時清除提示；MOCK 提示音失敗不產生 AI 提示', () => {
    const s = speakingAi();
    const failed = reduce(s, { type: 'OWNER_FAILED', attemptId: s.attemptId, owner: 'speech', code: 'AUDIO_SOURCE_FAILED' }).state;
    expect(reduce(failed, { type: 'NEXT' }).state.speechFallbackId).toBeNull();
    expect(reduce(failed, { type: 'REPLAY_INTRO', trackPositionMs: 0 }).state.speechFallbackId).toBeNull();
    let mock = reduce(initialEngineState(), { type: 'LOAD_SHOW', show: makeShow('showB', 2), sessionId: 'S2' }).state;
    mock = reduce(mock, { type: 'PLAY' }).state;
    expect(reduce(mock, { type: 'OWNER_FAILED', attemptId: mock.attemptId, owner: 'speech', code: 'AUDIO_SOURCE_FAILED' }).state.speechFallbackId).toBeNull();
  });

  it('提示元件顯示 AI 語音失敗、文字介紹全文與「重試語音」', () => {
    const html = renderToStaticMarkup(createElement(SpeechFallbackNotice, { djLine: '介紹 1', onRetry: () => undefined }));
    expect(html).toContain('AI 語音');
    expect(html).toContain('介紹 1');
    expect(html).toContain('重試語音');
  });
});

class RecordingAdapter implements MediaAdapter {
  readonly starts: StartRequest[] = [];
  start(request: StartRequest): Promise<void> { this.starts.push(request); return Promise.resolve(); }
  pause(): void {}
  resume(): Promise<void> { return Promise.resolve(); }
  seek(): void {}
  stop(): void {}
  getState() { return null; }
  subscribe(_listener: (event: AdapterEvent) => void) { return () => undefined; }
  destroy(): void {}
}

it('iPhone 手勢：使用者按播放的同一個同步呼叫內就對 AI 介紹音檔發出 start（同源私有 URL）', () => {
  const adapter = new RecordingAdapter();
  const engine = new PlaybackEngine(adapter, { djEnabled: true, canSeek: true });
  const show = aiShow();
  engine.loadShow(show);
  expect(adapter.starts).toHaveLength(0);
  engine.play();
  expect(adapter.starts).toHaveLength(1);
  const [first] = adapter.starts;
  expect(first).toMatchObject({ owner: 'speech', fromMs: 0 });
  expect(mockSourceResolver()('speech', first!.segment)).toBe(AI_URL(show.showId, show.segments[0]!.segmentId));
});

it('AI 語音 URL 只接受同源 /api/media/tts 路徑，外部或穿越路徑一律拒絕', () => {
  const segment = aiShow().segments[0]!;
  for (const url of ['https://evil.example/a.mp3', '//evil.example/a', '/api/media/tts/../../x', '/api/other']) {
    expect(() => mockSourceResolver()('speech', { ...segment, speech: { kind: 'ai_audio', aiVoice: true, url } })).toThrow();
  }
});

it('節目 warnings 中的供應商降級提示會顯示（不再只顯示帳本提醒），其他 warnings 不混入', () => {
  const warnings = [`${PROVIDER_NOTICES.llm}：OpenAI 尚待簽收上限數字，已降級為 mock。`, `${PROVIDER_NOTICES.tts}：今日或總預算已達上限。`, '模型自己的提醒'];
  const html = renderToStaticMarkup(createElement(ProviderNotices, { warnings }));
  expect(html).toContain('選曲服務暫時無法使用');
  expect(html).not.toContain('mock');
  expect(html).toContain('語音暫時無法使用');
  expect(html).not.toContain('模型自己的提醒');
  expect(renderToStaticMarkup(createElement(ProviderNotices, { warnings: ['模型自己的提醒'] }))).toBe('');
});

it.each([
  [PROVIDER_NOTICES.llm, '選曲服務暫時無法使用，請重新選歌。'],
  [PROVIDER_NOTICES.tts, '語音暫時無法使用，改為文字介紹。'],
  [PROVIDER_NOTICES.ttsQuotaDaily, '今日 AI 語音額度已用完，00:00 恢復。'],
  [PROVIDER_NOTICES.ttsQuotaTotal, 'AI 語音額度已用完，改為文字介紹。'],
])('一般模式依固定前綴 %s 選文案，developer mode 保留原文', (prefix, message) => {
  const warning = `${prefix}：安全診斷訊息`;
  try {
    vi.stubGlobal('window', { location: { search: '' } });
    const html = renderToStaticMarkup(createElement(ProviderNotices, { warnings: [warning] }));
    expect(html).toContain(message);
    expect(html).not.toContain('安全診斷訊息');
    if (prefix !== PROVIDER_NOTICES.ttsQuotaDaily) expect(html).not.toContain('00:00');
    vi.stubGlobal('window', { location: { search: '?developer=1' } });
    expect(renderToStaticMarkup(createElement(ProviderNotices, { warnings: [warning] }))).toContain(warning);
  } finally { vi.unstubAllGlobals(); }
});
