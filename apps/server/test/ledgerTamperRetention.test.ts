import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { RealProviderRuntime } from '../src/budget/runtime.js';
import { OpenAIEditorialPlanner, estimateLlmReservation } from '../src/providers/openai/planner.js';
import { OpenAITtsProvider } from '../src/providers/openai/tts.js';
import { toEditorialInput } from '../src/services/editorialInput.js';
import { planRequest } from './helpers.js';
import { realConfig, responsesBody, validDraftText } from './openaiHelpers.js';

const signal = () => new AbortController().signal;
const ctx = () => ({ signal: signal(), scenario: 'five' as const, attempt: 1 });
const ceil9 = (usd: number) => Math.ceil(usd * 1e9) / 1e9;

const TAMPERS: { name: string; tamper: (valid: string) => string }[] = [
  { name: '垃圾內容', tamper: () => 'not json at all' },
  { name: '總和不符', tamper: (valid) => JSON.stringify({ ...JSON.parse(valid), totalUsd: 0 }) },
  { name: '多餘欄位', tamper: (valid) => JSON.stringify({ ...JSON.parse(valid), bonusUsd: 5 }) },
];

it.each(TAMPERS)('帳本於執行中被改壞（$name）：之後 LLM 與 TTS 呼叫都被拒絕且不發 HTTP；修好檔案仍不放行（sticky）', async ({ tamper }) => {
  const config = realConfig();
  const runtime = new RealProviderRuntime(config.openai);
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3])));
  const tts = new OpenAITtsProvider(config.openai, runtime, fetchImpl);
  const planner = new OpenAIEditorialPlanner(config.openai, runtime, fetchImpl);
  await tts.synthesize('第一句', signal());
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  const valid = readFileSync(config.openai.ledgerPath, 'utf8');

  writeFileSync(config.openai.ledgerPath, tamper(valid));
  await expect(tts.synthesize('第二句', signal())).rejects.toThrow(/帳本/);
  await expect(planner.draft(toEditorialInput(planRequest()), ctx())).rejects.toThrow(/帳本/);
  expect(runtime.reason()).toMatch(/帳本/);
  expect(fetchImpl).toHaveBeenCalledTimes(1);

  // 還原成合法內容也不解除：拒絕原因一旦設定就保留到人工處理後重啟。
  writeFileSync(config.openai.ledgerPath, valid);
  await expect(tts.synthesize('第三句', signal())).rejects.toThrow(/帳本/);
  expect(runtime.reason()).toMatch(/帳本/);
  expect(runtime.ledger!.check()).toMatch(/帳本/);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  // 被拒絕的呼叫不得覆寫（也就不會「修好」或重置）帳本檔。
  expect(readFileSync(config.openai.ledgerPath, 'utf8')).toBe(valid);
});

type Failure = { name: string; attempts?: number; env?: Record<string, string>; respond: () => Promise<Response> };
const LLM_FAILURES: Failure[] = [
  { name: 'HTTP 500', respond: async () => new Response('upstream down', { status: 500 }) },
  { name: '逾時', env: { PROVIDER_TIMEOUT_MS: '10' }, respond: () => new Promise<Response>(() => {}) },
  { name: '回應缺 usage', respond: async () => { const { usage: _usage, ...body } = responsesBody(await validDraftText()); return Response.json(body); } },
];

it.each(LLM_FAILURES)('LLM 失敗（$name）不釋放預扣：重試累計遞增、跨重啟保留', async ({ env, respond }) => {
  const config = realConfig(env);
  const runtime = new RealProviderRuntime(config.openai);
  const fetchImpl = vi.fn<typeof fetch>(respond);
  const planner = new OpenAIEditorialPlanner(config.openai, runtime, fetchImpl);
  const input = toEditorialInput(planRequest());
  const each = ceil9(estimateLlmReservation(JSON.stringify(OpenAIEditorialPlanner.requestBody(config.openai, input)), config.openai).usd);
  expect(each).toBeGreaterThan(0);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await expect(planner.draft(input, ctx())).rejects.toBeDefined();
    expect(runtime.ledger!.snapshot().totalUsd).toBeCloseTo(each * attempt, 9);
  }
  expect(fetchImpl).toHaveBeenCalledTimes(3);
  expect(new RealProviderRuntime(config.openai).ledger!.snapshot().totalUsd).toBeCloseTo(each * 3, 9);
});

it('LLM 一直失敗也繞不過每日上限：預扣累計到日額即拒絕，不再發 HTTP', async () => {
  const input = toEditorialInput(planRequest());
  const probe = realConfig();
  const each = ceil9(estimateLlmReservation(JSON.stringify(OpenAIEditorialPlanner.requestBody(probe.openai, input)), probe.openai).usd);
  // 日額剛好容納 10.5 次預扣（單次仍 ≤ 日額 10%）：第 11 次必須在發請求前被擋下。
  const config = realConfig({ BUDGET_DAILY_USD: String(each * 10.5) });
  const runtime = new RealProviderRuntime(config.openai);
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response('upstream down', { status: 500 }));
  const planner = new OpenAIEditorialPlanner(config.openai, runtime, fetchImpl);
  for (let attempt = 1; attempt <= 10; attempt += 1) await expect(planner.draft(input, ctx())).rejects.toMatchObject({ code: 'FEATURE_RESTRICTED' });
  await expect(planner.draft(input, ctx())).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  expect(fetchImpl).toHaveBeenCalledTimes(10);
  expect(runtime.ledger!.snapshot().totalUsd).toBeCloseTo(each * 10, 9);
});

const TTS_FAILURES: Failure[] = [
  { name: 'HTTP 500', attempts: 2, respond: async () => new Response('bad', { status: 500 }) },
  { name: '逾時', env: { TTS_TIMEOUT_MS: '10' }, respond: () => new Promise<Response>(() => {}) },
  { name: '空音訊', respond: async () => new Response(new Uint8Array()) },
];

it.each(TTS_FAILURES)('TTS 失敗（$name）不釋放預扣：金額與每日字數都累計', async ({ env, respond, attempts = 1 }) => {
  const config = realConfig(env);
  const runtime = new RealProviderRuntime(config.openai);
  const fetchImpl = vi.fn<typeof fetch>(respond);
  const tts = new OpenAITtsProvider(config.openai, runtime, fetchImpl);
  const lines = ['第一句台詞', '第二句台詞', '第三句台詞'];
  for (const [index, line] of lines.entries()) {
    await expect(tts.synthesize(line, signal())).rejects.toBeDefined();
    const day = Object.values(runtime.ledger!.snapshot().days)[0]!;
    expect(day.usd).toBeCloseTo((index + 1) * attempts * 5 * 10 / 1e6, 9);
    expect(day.graphemes).toBe((index + 1) * attempts * 5);
  }
  expect(fetchImpl).toHaveBeenCalledTimes(3 * attempts);
});
