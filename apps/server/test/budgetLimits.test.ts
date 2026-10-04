import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { BudgetLedger, taipeiDay } from '../src/budget/ledger.js';
import { RealProviderRuntime } from '../src/budget/runtime.js';
import { ConfigError, loadConfig } from '../src/config/env.js';
import { MAX_CALL_SHARE_OF_DAILY, OpenAIEditorialPlanner, REQUEST_OVERHEAD_TOKENS, estimateLlmReservation } from '../src/providers/openai/planner.js';
import { OpenAITtsProvider } from '../src/providers/openai/tts.js';
import { toEditorialInput } from '../src/services/editorialInput.js';
import { planRequest } from './helpers.js';
import { fakeOpenAI, realConfig, responsesBody, validDraftText } from './openaiHelpers.js';

const signal = () => new AbortController().signal;
const ctx = () => ({ signal: signal(), scenario: 'five' as const, attempt: 1 });
const readLedger = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as { totalUsd: number; days: Record<string, { usd: number; plans: number; graphemes: number }> };

it('預設上限：每日 US$1、總額 US$10、每日 20 plan、每日 4000 grapheme；只能調低不能調高', () => {
  expect(loadConfig({}).openai.budget).toEqual({ dailyUsd: 1, totalUsd: 10, plansPerDay: 20, graphemesPerDay: 4000 });
  expect(loadConfig({ BUDGET_DAILY_USD: '0.5', BUDGET_TOTAL_USD: '3', BUDGET_MAX_PLANS_PER_DAY: '5', TTS_GRAPHEME_BUDGET_PER_DAY: '500' }).openai.budget)
    .toEqual({ dailyUsd: 0.5, totalUsd: 3, plansPerDay: 5, graphemesPerDay: 500 });
  for (const env of [{ BUDGET_DAILY_USD: '1.01' }, { BUDGET_TOTAL_USD: '10.5' }, { BUDGET_MAX_PLANS_PER_DAY: '21' }, { TTS_GRAPHEME_BUDGET_PER_DAY: '4001' }, { BUDGET_DAILY_USD: '0' }, { OPENAI_MAX_OUTPUT_TOKENS: '16385' }]) {
    expect(() => loadConfig(env), JSON.stringify(env)).toThrow(ConfigError);
  }
});

it('每日 20 plan（預設）：第 21 次拒絕，台北換日後恢復；計數跨重啟保留', async () => {
  let now = Date.parse('2026-10-05T10:00:00Z');
  const config = realConfig();
  const runtime = new RealProviderRuntime(config.openai, () => now);
  for (let i = 0; i < 20; i += 1) await runtime.claimPlan(signal());
  await expect(runtime.claimPlan(signal())).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  await expect(new RealProviderRuntime(config.openai, () => now).claimPlan(signal())).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  now = Date.parse('2026-10-05T16:00:00Z');
  await runtime.claimPlan(signal());
  expect(readLedger(config.openai.ledgerPath).days).toMatchObject({ '2026-10-05': { plans: 20 }, '2026-10-06': { plans: 1 } });
});

it('每日 US$1 與總額 US$10（預設）：跨日累計到 10 後即使換日也拒絕', () => {
  let now = Date.parse('2026-10-01T04:00:00Z');
  const path = realConfig().openai.ledgerPath;
  const ledger = new BudgetLedger(path, loadConfig({}).openai.budget, () => now);
  ledger.retain(ledger.reserve({ usd: 1 }));
  expect(() => ledger.reserve({ usd: 0.000000001 })).toThrow(/預算/);
  for (let day = 1; day < 10; day += 1) { now += 86_400_000; ledger.retain(ledger.reserve({ usd: 1 })); }
  now += 86_400_000;
  expect(() => ledger.reserve({ usd: 0.01 })).toThrow(/預算/);
  expect(new BudgetLedger(path, loadConfig({}).openai.budget, () => now).snapshot().totalUsd).toBe(10);
});

it('TTS 每日 4000 grapheme（預設）：滿額後拒絕且不發請求；快取命中不扣字數', async () => {
  const config = realConfig();
  const runtime = new RealProviderRuntime(config.openai);
  const fetchImpl = fakeOpenAI();
  const tts = new OpenAITtsProvider(config.openai, runtime, fetchImpl);
  runtime.ledger!.retain(runtime.ledger!.reserve({ usd: 0, graphemes: 3995 }));
  await tts.synthesize('一二三四五', signal());
  await tts.synthesize('一二三四五', signal());
  await expect(tts.synthesize('六', signal())).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(readLedger(config.openai.ledgerPath).days[taipeiDay(Date.now())]!.graphemes).toBe(4000);
});

it('預扣式：發出 HTTP 前帳本檔已寫入完整預扣（含 max_output_tokens），成功後才按 usage 釋放差額', async () => {
  const config = realConfig({ OPENAI_MAX_OUTPUT_TOKENS: '2000' });
  const runtime = new RealProviderRuntime(config.openai);
  const text = await validDraftText();
  let seenDuringCall = -1;
  let expected = -1;
  const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
    seenDuringCall = readLedger(config.openai.ledgerPath).totalUsd;
    expected = estimateLlmReservation(String(init?.body), config.openai).usd;
    return Response.json(responsesBody(text, { input_tokens: 1000, output_tokens: 500 }));
  });
  await new OpenAIEditorialPlanner(config.openai, runtime, fetchImpl).draft(toEditorialInput(planRequest()), ctx());
  expect(expected).toBeGreaterThan((2000 * 2) / 1e6);
  expect(seenDuringCall).toBeCloseTo(expected, 9);
  expect(readLedger(config.openai.ledgerPath).totalUsd).toBeCloseTo((1000 * 1 + 500 * 2) / 1e6, 9);
});

it('LLM 預扣估算保守但可用：輸入 token 上界 ≥ 請求 UTF-8 位元組數；真實尺寸請求在常見單價下遠低於日額', () => {
  const history = Array.from({ length: 20 }, (_, i) => ({ date: '2026-10-05T00:00:00.000Z', seed: '下雨的深夜開車回家', recommendation: `Artist ${i} — Song ${i}`, rating: '愛' as const, reason: '低頻溫暖的質地，很適合' }));
  const input = { ...toEditorialInput(planRequest({ seed: { kind: 'feeling', text: '下雨的深夜，一個人開車回家，想聽有點溫暖但不要太悲傷的歌'.repeat(3), artist: null } })), history };
  const body = JSON.stringify(OpenAIEditorialPlanner.requestBody(realConfig().openai, input));
  const bytes = Buffer.byteLength(body, 'utf8');
  for (const [inputPrice, outputPrice] of [['0.4', '1.6'], ['2', '8']] as const) {
    const config = realConfig({ OPENAI_PRICE_INPUT_PER_1M_TOKENS: inputPrice, OPENAI_PRICE_OUTPUT_PER_1M_TOKENS: outputPrice });
    const estimate = estimateLlmReservation(body, config.openai);
    expect(estimate.inputTokens).toBe(bytes + REQUEST_OVERHEAD_TOKENS);
    expect(estimate.usd).toBeLessThanOrEqual(config.openai.budget.dailyUsd * MAX_CALL_SHARE_OF_DAILY);
  }
  expect(estimateLlmReservation(body, realConfig({ OPENAI_PRICE_INPUT_PER_1M_TOKENS: '0.4', OPENAI_PRICE_OUTPUT_PER_1M_TOKENS: '1.6' }).openai).usd).toBeLessThan(0.02);
});

it('單次 LLM 預扣超過每日額度的 10%（過貴模型或過大 max_output_tokens）時拒絕：不發請求、不扣帳、原因可讀', async () => {
  const config = realConfig({ OPENAI_PRICE_INPUT_PER_1M_TOKENS: '15', OPENAI_PRICE_OUTPUT_PER_1M_TOKENS: '120' });
  const runtime = new RealProviderRuntime(config.openai);
  const fetchImpl = fakeOpenAI();
  await expect(new OpenAIEditorialPlanner(config.openai, runtime, fetchImpl).draft(toEditorialInput(planRequest()), ctx())).rejects.toThrow(/單次預扣/);
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(runtime.ledger!.snapshot().totalUsd).toBe(0);
  expect(runtime.statusReason()).toMatch(/單次預扣/);
});

it('併發 1：同一 runtime 下 LLM 與 TTS 多個請求絕不同時在途', async () => {
  const config = realConfig();
  const runtime = new RealProviderRuntime(config.openai);
  let active = 0;
  let maximum = 0;
  const text = await validDraftText();
  const fetchImpl = vi.fn<typeof fetch>(async (url) => {
    active += 1; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 3));
    active -= 1;
    return String(url).endsWith('/responses') ? Response.json(responsesBody(text)) : new Response(new Uint8Array([1]));
  });
  const planner = new OpenAIEditorialPlanner(config.openai, runtime, fetchImpl);
  const tts = new OpenAITtsProvider(config.openai, runtime, fetchImpl);
  await Promise.all([planner.draft(toEditorialInput(planRequest()), ctx()), tts.synthesize('一', signal()), planner.draft(toEditorialInput(planRequest()), ctx()), tts.synthesize('二', signal())]);
  expect(fetchImpl).toHaveBeenCalledTimes(4);
  expect(maximum).toBe(1);
});
