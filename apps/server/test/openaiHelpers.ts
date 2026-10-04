import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { MockEditorialPlanner } from '../src/providers/mockPlanner.js';

export function realEnv(extra: Record<string, string> = {}): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'qualia-openai-'));
  return { MOCK_PHASE_MS: '0', LLM_PROVIDER: 'openai', TTS_PROVIDER: 'openai', OPENAI_API_KEY: 'TEST-fake-secret',
    OPENAI_REAL_CALLS_APPROVED: 'true', OPENAI_TEXT_MODEL: 'TEST-text', OPENAI_TTS_MODEL: 'TEST-tts', OPENAI_TTS_VOICE: 'TEST-voice',
    OPENAI_PRICE_INPUT_PER_1M_TOKENS: '1', OPENAI_PRICE_OUTPUT_PER_1M_TOKENS: '2', OPENAI_PRICE_TTS_PER_1M_CHARS: '10',
    BUDGET_LEDGER_PATH: join(dir, 'ledger.json'), KILL_SWITCH_FILE: join(dir, 'KILL_SWITCH'), TTS_CACHE_DIR: join(dir, 'tts'), ...extra };
}

export function realConfig(extra: Record<string, string> = {}) {
  return loadConfig(realEnv(extra));
}

/** 合法 PlanDraft 的 JSON 字串，模擬模型輸出（內容仍被 PlanService 當不受信任資料驗證）；每段台詞不同，避免快取合併。 */
export async function validDraftText(): Promise<string> {
  const draft = await new MockEditorialPlanner().draft(
    { seedText: 'TEST', seedKind: 'feeling', seedArtist: null, history: [], tuning: null, djEnabled: true, djLength: 'short' },
    { signal: new AbortController().signal, attempt: 1, scenario: 'five' },
  ) as { candidates: { djLine: string }[] };
  return JSON.stringify({ ...draft, candidates: draft.candidates.map((c, i) => ({ ...c, djLine: `第${i + 1}首 ${c.djLine}` })) });
}

export const responsesBody = (text: string, usage = { input_tokens: 100, output_tokens: 100 }) =>
  ({ id: 'resp_TEST', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }], usage });

export const MP3_BYTES = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6]);

/** 注入式假 OpenAI：依端點回應，記錄每次請求；永遠不碰真實網路。 */
export function fakeOpenAI(handlers: { responses?: () => Response | Promise<Response>; speech?: () => Response | Promise<Response> } = {}) {
  return vi.fn<typeof fetch>(async (url) => {
    const target = String(url);
    if (target === 'https://api.openai.com/v1/responses') return handlers.responses ? handlers.responses() : Response.json(responsesBody(await validDraftText()));
    if (target === 'https://api.openai.com/v1/audio/speech') return handlers.speech ? handlers.speech() : new Response(MP3_BYTES, { headers: { 'content-type': 'audio/mpeg' } });
    throw new Error(`unexpected URL ${target}`);
  });
}
