import { beforeEach, expect, it, vi } from 'vitest';
import { RealProviderRuntime } from '../src/budget/runtime.js';
import { OpenAITtsProvider } from '../src/providers/openai/tts.js';
import { realConfig } from './openaiHelpers.js';

/** 曄試聽選定 B2（cedar＋繁中詳細 instructions）的 instr-zh 全文，逐字對照 tts-ab-README。 */
const B2_INSTRUCTIONS = '請用台灣華語（臺灣國語）的口音朗讀，像台北在地的深夜電台主持人在跟朋友聊天。語氣溫暖、低調、放鬆，語速自然偏慢，句與句之間有輕輕的停頓和呼吸。使用台灣人日常口語的聲調與節奏，輕聲與語尾助詞（啊、喔、吧）要自然，不要捲舌過度。不要大陸普通話的播音腔，不要兒化音，不要過度戲劇化或推銷感。英文歌名用清楚、自然的英語發音念出，念完再回到台灣華語。';
const bodyOf = (fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>, call = 0) => JSON.parse(String(fetchImpl.mock.calls[call]![1]?.body));

beforeEach(() => { vi.stubGlobal('fetch', () => { throw new Error('禁止真實網路'); }); });
it('AI 語音標示與快取命中跨重啟保留；相同文字 model voice 只計費一次', async () => {
  const config = realConfig();
  const runtime = new RealProviderRuntime(config.openai);
  const fetchImpl = vi.fn<typeof fetch>(async (_url, options) => {
    expect(JSON.parse(String(options?.body))).toMatchObject({ model: 'TEST-tts', voice: 'TEST-voice', instructions: B2_INSTRUCTIONS, response_format: 'mp3' });
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
it('OPENAI_TTS_INSTRUCTIONS 覆寫生效；預扣仍只按台詞 code points × 保守單價，不受 instructions 長度影響', async () => {
  const config = realConfig({ OPENAI_TTS_INSTRUCTIONS: '自訂聲線指示。'.repeat(100) });
  const runtime = new RealProviderRuntime(config.openai);
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3])));
  await new OpenAITtsProvider(config.openai, runtime, fetchImpl).synthesize('你好。', new AbortController().signal);
  expect(bodyOf(fetchImpl).instructions).toBe('自訂聲線指示。'.repeat(100));
  expect(runtime.ledger!.snapshot().totalUsd).toBeCloseTo(3 * 10 / 1e6, 9);
});
it('OPENAI_TTS_INSTRUCTIONS 空白或空值回到預設 B2 instructions', async () => {
  for (const value of ['', '   ']) {
    const config = realConfig({ OPENAI_TTS_INSTRUCTIONS: value });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3])));
    await new OpenAITtsProvider(config.openai, new RealProviderRuntime(config.openai), fetchImpl).synthesize('你好。', new AbortController().signal);
    expect(bodyOf(fetchImpl).instructions).toBe(B2_INSTRUCTIONS);
  }
});
it('instructions 變更會換快取 key：同文字重新合成，不沿用舊聲線音檔', async () => {
  const config = realConfig();
  const runtime = new RealProviderRuntime(config.openai);
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3])));
  const signal = new AbortController().signal;
  const byDefault = await new OpenAITtsProvider(config.openai, runtime, fetchImpl).synthesize('你好。', signal);
  const overridden = await new OpenAITtsProvider({ ...config.openai, ttsInstructions: '另一種聲線。' }, runtime, fetchImpl).synthesize('你好。', signal);
  expect(overridden.url).not.toBe(byDefault.url);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(bodyOf(fetchImpl, 1).instructions).toBe('另一種聲線。');
});
