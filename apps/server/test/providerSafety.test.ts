import { chmodSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import { RealProviderRuntime } from '../src/budget/runtime.js';
import { OpenAITtsProvider } from '../src/providers/openai/tts.js';
import { OpenAIEditorialPlanner } from '../src/providers/openai/planner.js';
import { toEditorialInput } from '../src/services/editorialInput.js';
import { planRequest } from './helpers.js';
import { realConfig } from './openaiHelpers.js';

beforeEach(() => { vi.stubGlobal('fetch', () => { throw new Error('禁止真實網路'); }); });
it('LLM 與 TTS 同時請求只允許一個進入 provider，等待中的停止開關仍生效', async () => {
  const config = realConfig();
  const runtime = new RealProviderRuntime(config.openai);
  let finish!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  let active = 0;
  let maximum = 0;
  const fetchImpl = vi.fn<typeof fetch>(async () => {
    active++; maximum = Math.max(maximum, active); markStarted();
    await new Promise<void>((resolve) => { finish = resolve; });
    active--;
    return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }], usage: { input_tokens: 1, output_tokens: 1 } });
  });
  const llm = new OpenAIEditorialPlanner(config.openai, runtime, fetchImpl);
  const tts = new OpenAITtsProvider(config.openai, runtime, fetchImpl);
  const first = llm.draft(toEditorialInput(planRequest()), { signal: new AbortController().signal, scenario: 'five', attempt: 1 });
  await started;
  const second = tts.synthesize('你好', new AbortController().signal);
  writeFileSync(config.openai.killSwitchFile, 'stop');
  const rejected = expect(second).rejects.toThrow(/停止/);
  finish(); await first; await rejected;
  expect(maximum).toBe(1); expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it('成功串行兩個請求；動態環境停止開關與 abort 在呼叫前阻擋', async () => {
  const config = realConfig();
  const runtime = new RealProviderRuntime(config.openai);
  let active = 0;
  let maximum = 0;
  const fetchImpl = vi.fn<typeof fetch>(async () => {
    active++; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5)); active--;
    return new Response(new Uint8Array([1]));
  });
  const tts = new OpenAITtsProvider(config.openai, runtime, fetchImpl);
  await Promise.all(['一', '二'].map((text) => tts.synthesize(text, new AbortController().signal)));
  expect(maximum).toBe(1); expect(fetchImpl).toHaveBeenCalledTimes(2);
  config.openai.killSwitch = () => true;
  await expect(tts.synthesize('三', new AbortController().signal)).rejects.toThrow(/停止/);
  const controller = new AbortController(); controller.abort('cancel');
  await expect(tts.synthesize('四', controller.signal)).rejects.toBe('cancel');
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
it('逾時及供應商錯誤保留預扣，例外不洩漏金鑰', async () => {
  const config = realConfig({ TTS_TIMEOUT_MS: '10' });
  const runtime = new RealProviderRuntime(config.openai);
  const timeout = new OpenAITtsProvider(config.openai, runtime, async () => new Promise<Response>(() => {}));
  await expect(timeout.synthesize('你好', new AbortController().signal)).rejects.toThrow(/時間|逾時/);
  expect(runtime.ledger!.snapshot().totalUsd).toBeCloseTo(0.00002);
  const failed = new OpenAITtsProvider(config.openai, runtime, async () => { throw new Error(config.openai.apiKey); });
  await expect(failed.synthesize('失敗', new AbortController().signal)).rejects.toThrow('OpenAI 回應無法使用');
  expect(runtime.ledger!.snapshot().totalUsd).toBeCloseTo(0.00004);
});
it('帳本於啟動後損毀或寫入失敗立即 fail closed，不進 provider', async () => {
  const config = realConfig();
  const runtime = new RealProviderRuntime(config.openai);
  unlinkSync(config.openai.ledgerPath); mkdirSync(config.openai.ledgerPath);
  const fetchImpl = vi.fn<typeof fetch>();
  const tts = new OpenAITtsProvider(config.openai, runtime, fetchImpl);
  await expect(tts.synthesize('你好', new AbortController().signal)).rejects.toThrow(/帳本/);
  expect(runtime.reason()).toContain('帳本'); expect(fetchImpl).not.toHaveBeenCalled();
});
it('金額預扣超過每日上限時不發請求，capabilities 的健康理由可讀', async () => {
  const config = realConfig({ BUDGET_DAILY_USD: '0.001' });
  const runtime = new RealProviderRuntime(config.openai);
  const fetchImpl = vi.fn<typeof fetch>();
  const planner = new OpenAIEditorialPlanner(config.openai, runtime, fetchImpl);
  await expect(planner.draft(toEditorialInput(planRequest()), { signal: new AbortController().signal, scenario: 'five', attempt: 1 })).rejects.toThrow(/預算/);
  expect(runtime.statusReason()).toContain('預算'); expect(fetchImpl).not.toHaveBeenCalled();
});
it('已送出請求被 abort 時保留預扣且不洩漏 provider 例外', async () => {
  const config = realConfig();
  const runtime = new RealProviderRuntime(config.openai);
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const fetchImpl: typeof fetch = async () => { started(); return new Promise<Response>(() => {}); };
  const tts = new OpenAITtsProvider(config.openai, runtime, fetchImpl);
  const response = tts.synthesize('你好', controller.signal);
  const rejected = expect(response).rejects.toThrow(/逾時/);
  await ready; controller.abort(); await rejected;
  expect(runtime.ledger!.snapshot().totalUsd).toBeCloseTo(0.00002);
});

it('原子寫入權限失敗時停用供應商，健康資訊回報帳本寫入失敗', async () => {
  const config = realConfig();
  const runtime = new RealProviderRuntime(config.openai);
  const fetchImpl = vi.fn<typeof fetch>();
  const planner = new OpenAIEditorialPlanner(config.openai, runtime, fetchImpl);
  const dir = dirname(config.openai.ledgerPath);
  chmodSync(dir, 0o500);
  try {
    await expect(planner.draft(toEditorialInput(planRequest()), { signal: new AbortController().signal, scenario: 'five', attempt: 1 })).rejects.toThrow(/寫入失敗/);
    expect(runtime.reason()).toContain('帳本寫入失敗'); expect(fetchImpl).not.toHaveBeenCalled();
  } finally { chmodSync(dir, 0o700); }
});
