import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { DjIntroduction } from '../src/features/player/DjIntroduction';
import { ProviderStatus } from '../src/features/settings/ProviderStatus';

beforeEach(() => { vi.stubGlobal('fetch', () => { throw new Error('禁止真實網路'); }); });
it('DJ 播放處明示 AI 合成語音，其他介紹不露出測試標示', () => {
  const props = { djLine: '你好', paused: false, onSkip: () => undefined };
  expect(renderToStaticMarkup(createElement(DjIntroduction, { ...props, aiVoice: true }))).toContain('AI 合成語音');
  expect(renderToStaticMarkup(createElement(DjIntroduction, props))).not.toContain('MOCK');
});
it('設定頁呈現供應商降級原因', () => {
  expect(renderToStaticMarkup(createElement(ProviderStatus, { providers: { llm: 'mock', tts: 'mock', reason: 'OpenAI 尚待簽收上限數字，已降級為 mock。' } }))).toContain('尚待簽收');
});
it('AI 語音只允許同源私有 API locator；舊音訊仍使用 MOCK blob', async () => {
  const { mockSourceResolver } = await import('../src/audio/adapters/htmlAudioAdapter');
  const { makeShow } = await import('./fixtures');
  const { SpeechLocatorSchema } = await import('@qualia/contracts');
  const segment = makeShow().segments[0]!;
  expect(SpeechLocatorSchema.safeParse(segment.speech).success).toBe(true);
  expect(SpeechLocatorSchema.safeParse({ kind: 'ai_audio', url: '/api/media/tts/test' }).success).toBe(false);
  expect(SpeechLocatorSchema.safeParse({ kind: 'ai_audio', aiVoice: false, url: '/api/media/tts/test' }).success).toBe(false);
  segment.speech = { kind: 'ai_audio', aiVoice: true, url: '/api/media/tts/test' };
  expect(mockSourceResolver()('speech', segment)).toBe('/api/media/tts/test');
});
