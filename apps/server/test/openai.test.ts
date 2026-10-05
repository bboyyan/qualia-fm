import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { realConfig } from './openaiHelpers.js';
import { RealProviderRuntime } from '../src/budget/runtime.js';
import { OpenAIEditorialPlanner } from '../src/providers/openai/planner.js';
import { SYSTEM_PROMPT } from '../src/providers/openai/resources.js';
import { toEditorialInput } from '../src/services/editorialInput.js';
import { planRequest } from './helpers.js';

beforeEach(() => { vi.stubGlobal('fetch', () => { throw new Error('禁止真實網路'); }); });
it('Structured Outputs 使用指定模型、token 上限、同步 prompt；資料與指令分開且結果仍不受信任', async () => {
  const config = realConfig();
  const runtime = new RealProviderRuntime(config.openai);
  const fetchImpl = vi.fn<typeof fetch>(async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    expect(body.model).toBe('TEST-text');
    expect(body.max_output_tokens).toBe(4096);
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true, name: 'plan_draft' });
    expect(body.input[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(body.input[1].role).toBe('user');
    expect(body.input[1].content).toContain('TEST fake seed');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"untrusted":true}' }] }], usage: { input_tokens: 10, output_tokens: 20 } });
  });
  const planner = new OpenAIEditorialPlanner(config.openai, runtime, fetchImpl);
  expect(await planner.draft(toEditorialInput(planRequest()), { signal: new AbortController().signal, scenario: 'five', attempt: 1 })).toEqual({ untrusted: true });
  expect(runtime.ledger!.snapshot().totalUsd).toBeCloseTo(0.00005);
  expect(SYSTEM_PROMPT).toBe(readFileSync('handoff/prompts/sonic-qualia-system.md', 'utf8'));
});
it('選歌提示詞要求台灣用語（禁大陸用語、數字中文念法、口語 DJ），且既有 DJ 硬規則全部保留', () => {
  const md = readFileSync('handoff/prompts/sonic-qualia-system.md', 'utf8');
  expect(SYSTEM_PROMPT).toBe(md);
  for (const term of ['視頻', '質量', '信息', '質感']) expect(SYSTEM_PROMPT, term).toContain(`「${term}」`);
  expect(SYSTEM_PROMPT).toMatch(/台灣用語/);
  expect(SYSTEM_PROMPT).toMatch(/數字.*中文念法/);
  expect(SYSTEM_PROMPT).toContain('英文名字是');
  for (const rule of ['30–55 grapheme clusters', '上限80', '不得引用歌詞', '不說自己真實身份或模仿特定真人', 'djLine 應能單獨依 Seed 成立'])
    expect(SYSTEM_PROMPT, rule).toContain(rule);
});
it('標準版引言加厚（BRA-117）：曲名、藝人、為什麼接這首、聽的時候注意什麼；長度依 djLength 區分', () => {
  for (const rule of ['djLength', 'short', 'standard', '90–150 grapheme clusters', '上限180', '曲名', '藝人', '為什麼接這首', '聽的時候', '英文名字是'])
    expect(SYSTEM_PROMPT, rule).toContain(rule);
  // 不把 Spotify metadata 餵 LLM：提示詞仍明文禁止，且只靠 EditorialInput 防火牆提供輸入。
  expect(SYSTEM_PROMPT).toContain('輸入不得包含 Spotify API 資料');
});
