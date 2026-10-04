import { beforeEach, expect, it, vi } from 'vitest';
import { RealProviderRuntime } from '../src/budget/runtime.js';
import { OpenAITtsProvider } from '../src/providers/openai/tts.js';
import { realConfig } from './openaiHelpers.js';

beforeEach(() => { vi.stubGlobal('fetch', () => { throw new Error('禁止真實網路'); }); });
it('AI 語音標示與快取命中跨重啟保留；相同文字 model voice 只計費一次', async () => {
  const config = realConfig();
  const runtime = new RealProviderRuntime(config.openai);
  const fetchImpl = vi.fn<typeof fetch>(async (_url, options) => {
    expect(JSON.parse(String(options?.body))).toMatchObject({ model: 'TEST-tts', voice: 'TEST-voice', instructions: expect.stringContaining('台灣國語'), response_format: 'mp3' });
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } });
  });
  const tts = new OpenAITtsProvider(config.openai, runtime, fetchImpl);
  const signal = new AbortController().signal;
  const first = await tts.synthesize('你好。', signal);
  expect(first.aiVoice).toBe(true);
  expect(await new OpenAITtsProvider(config.openai, runtime, fetchImpl).synthesize('你好。', signal)).toEqual(first);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(runtime.ledger!.snapshot().totalUsd).toBeCloseTo(0.00003);
});
it('送出前以 grapheme 檢查 80 上限及每日字數預算，不呼叫 provider', async () => {
  const config = realConfig({ TTS_GRAPHEME_BUDGET_PER_DAY: '2' });
  const fetchImpl = vi.fn<typeof fetch>();
  const tts = new OpenAITtsProvider(config.openai, new RealProviderRuntime(config.openai), fetchImpl);
  await expect(tts.synthesize('👨‍👩‍👧‍👦'.repeat(81), new AbortController().signal)).rejects.toThrow(/80/);
  await expect(tts.synthesize('你好。', new AbortController().signal)).rejects.toThrow(/預算/);
  expect(fetchImpl).not.toHaveBeenCalled();
});
it('TTL 到期重新合成，快取大小超限淘汰較舊音訊；voice 或 model 改變不共用', async () => {
  let now = Date.now();
  const config = realConfig({ TTS_CACHE_MAX_MB: '1', TTS_CACHE_TTL_HOURS: '1' });
  const runtime = new RealProviderRuntime(config.openai);
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new Uint8Array(600000)));
  const signal = new AbortController().signal;
  const tts = new OpenAITtsProvider(config.openai, runtime, fetchImpl, () => now);
  const first = await tts.synthesize('一', signal);
  now += 1000;
  const second = await tts.synthesize('二', signal);
  expect(tts.read(first.url.split('/').at(-1)!)).toBeNull();
  expect(tts.read(second.url.split('/').at(-1)!)).not.toBeNull();
  now += 3600_000;
  await tts.synthesize('二', signal);
  const other = new OpenAITtsProvider({ ...config.openai, voice: 'TEST-other' }, runtime, fetchImpl, () => now);
  await other.synthesize('二', signal);
  const model = new OpenAITtsProvider({ ...config.openai, ttsModel: 'TEST-other-model' }, runtime, fetchImpl, () => now);
  await model.synthesize('二', signal);
  expect(fetchImpl).toHaveBeenCalledTimes(5);
});
it('即使同毫秒建立，淘汰也不會刪除剛合成且已回傳的音訊', async () => {
  const config = realConfig({ TTS_CACHE_MAX_MB: '1' });
  const runtime = new RealProviderRuntime(config.openai);
  const tts = new OpenAITtsProvider(config.openai, runtime, async () => new Response(new Uint8Array(600000)), () => 1800000000000);
  for (const text of ['一', '二', '三', '四', '五', '六']) {
    const locator = await tts.synthesize(text, new AbortController().signal);
    expect(tts.read(locator.url.split('/').at(-1)!)).not.toBeNull();
  }
});
