import { expect, it, vi } from 'vitest';
import { RealProviderRuntime } from '../src/budget/runtime.js';
import { OpenAITtsProvider } from '../src/providers/openai/tts.js';
import { MP3_BYTES, realConfig } from './openaiHelpers.js';

it.each([408, 500, 502, 503, 504])('TTS HTTP %i 瞬時失敗只重試一次，逐次保留預扣，成功後可命中快取', async (status) => {
  const config = realConfig();
  const runtime = new RealProviderRuntime(config.openai);
  const fetchImpl = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('PRIVATE token=secret', { status }))
    .mockResolvedValueOnce(new Response(MP3_BYTES));
  const tts = new OpenAITtsProvider(config.openai, runtime, fetchImpl);
  const signal = new AbortController().signal;
  const speech = await tts.synthesize('你好。', signal);
  expect(await tts.synthesize('你好。', signal)).toEqual(speech);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(runtime.ledger!.snapshot().totalUsd).toBeCloseTo(0.00006, 9);
  expect(Object.values(runtime.ledger!.snapshot().days)[0]!.graphemes).toBe(6);
});

it('重試仍失敗：安全診斷帶 HTTP 錯誤碼及嘗試次數，不含供應商本文', async () => {
  const config = realConfig();
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response('PRIVATE sk-proj-secret', { status: 503 }));
  await expect(new OpenAITtsProvider(config.openai, new RealProviderRuntime(config.openai), fetchImpl)
    .synthesize('你好。', new AbortController().signal)).rejects.toMatchObject({
      providerCode: 'HTTP_503', providerStatus: 503, providerAttempts: 2, providerRetryable: true,
    });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it.each([400, 401, 403, 429])('TTS HTTP %i 不自動重試', async (status) => {
  const config = realConfig();
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response('PRIVATE', { status }));
  await expect(new OpenAITtsProvider(config.openai, new RealProviderRuntime(config.openai), fetchImpl)
    .synthesize('你好。', new AbortController().signal)).rejects.toMatchObject({
      providerCode: `HTTP_${status}`, providerStatus: status, providerAttempts: 1, providerRetryable: false,
    });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it('網路 TypeError 可重試，但不傳遞原始例外', async () => {
  const config = realConfig();
  const fetchImpl = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('PRIVATE bearer secret'))
    .mockResolvedValueOnce(new Response(MP3_BYTES));
  await expect(new OpenAITtsProvider(config.openai, new RealProviderRuntime(config.openai), fetchImpl)
    .synthesize('你好。', new AbortController().signal)).resolves.toMatchObject({ kind: 'ai_audio' });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it('失敗預扣後字數額度不足：重試仍先被既有硬帽擋住', async () => {
  const config = realConfig({ TTS_GRAPHEME_BUDGET_PER_DAY: '3' });
  const runtime = new RealProviderRuntime(config.openai);
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response('down', { status: 503 }));
  await expect(new OpenAITtsProvider(config.openai, runtime, fetchImpl)
    .synthesize('你好。', new AbortController().signal)).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(runtime.ledger!.snapshot().totalUsd).toBeCloseTo(0.00003, 9);
});

it('重試等待也受原本 TTS timeout 限制，不發第二次請求', async () => {
  const config = realConfig({ TTS_TIMEOUT_MS: '50' });
  const runtime = new RealProviderRuntime(config.openai);
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response('down', { status: 503 }));
  await expect(new OpenAITtsProvider(config.openai, runtime, fetchImpl)
    .synthesize('你好。', new AbortController().signal)).rejects.toMatchObject({ code: 'PLAN_TIMEOUT' });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(runtime.ledger!.snapshot().totalUsd).toBeCloseTo(0.00003, 9);
});

it.each(['BUDGET_DAILY_USD', 'BUDGET_TOTAL_USD'])('%s 只容納一次預扣：重試不越過金額硬帽', async (limit) => {
  const config = realConfig({ [limit]: '0.00003' });
  const runtime = new RealProviderRuntime(config.openai);
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response('down', { status: 503 }));
  await expect(new OpenAITtsProvider(config.openai, runtime, fetchImpl)
    .synthesize('你好。', new AbortController().signal)).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(runtime.ledger!.snapshot().totalUsd).toBeCloseTo(0.00003, 9);
});

it('取消或停止開關在重試等待時生效，不發第二次 HTTP', async () => {
  for (const cancelled of [true, false]) {
    const config = realConfig();
    let killed = false;
    config.openai.killSwitch = () => killed;
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      if (cancelled) controller.abort('cancel');
      else killed = true;
      return new Response('down', { status: 503 });
    });
    await expect(new OpenAITtsProvider(config.openai, new RealProviderRuntime(config.openai), fetchImpl)
      .synthesize('你好。', controller.signal)).rejects.toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  }
});

it('第二次請求未回覆仍共用原本 timeout，不給重試新的完整時限', async () => {
  const config = realConfig({ TTS_TIMEOUT_MS: '300' });
  let retrySignal: AbortSignal | undefined;
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('down', { status: 503 }))
    .mockImplementationOnce(async (_url, options) => {
      retrySignal = options!.signal!;
      // 第二次請求只剩約 100ms；若重新給滿 300ms，這次會成功而非 timeout。
      await new Promise((resolve) => setTimeout(resolve, 200));
      return new Response(MP3_BYTES);
    });
  await expect(new OpenAITtsProvider(config.openai, new RealProviderRuntime(config.openai), fetchImpl)
    .synthesize('你好。', new AbortController().signal)).rejects.toMatchObject({ code: 'PLAN_TIMEOUT', providerAttempts: 2 });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(retrySignal?.aborted).toBe(true);
});


it('供應商本文／code／headers 與網路例外即使含 token，也不進安全例外', async () => {
  const privateValue = 'PRIVATE sk-proj-CANARY bearer-token';
  for (const network of [true, false]) {
    const config = realConfig();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      if (network) throw new TypeError(privateValue);
      return Response.json({ error: { code: privateValue, message: privateValue } }, {
        status: 503, headers: { 'x-request-id': privateValue },
      });
    });
    const error = await new OpenAITtsProvider(config.openai, new RealProviderRuntime(config.openai), fetchImpl)
      .synthesize('你好。', new AbortController().signal).catch((error: unknown) => error);
    expect(error).toMatchObject({ providerCode: network ? 'NETWORK_ERROR' : 'HTTP_503', providerAttempts: 2 });
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(privateValue);
  }
});
