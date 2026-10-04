/**
 * 對照官方文件的請求形狀（見 docs/openai-providers-and-budget.md「API 欄位查證」）：
 * POST /v1/responses：model、input（system/user role）、max_output_tokens、store、text.format{type:json_schema,name,strict,schema}
 * POST /v1/audio/speech：model、voice、input（≤4096 字元）、instructions（tts-1／tts-1-hd 不支援）、response_format=mp3
 */
import { expect, it } from 'vitest';
import { RealProviderRuntime } from '../src/budget/runtime.js';
import { OpenAIEditorialPlanner } from '../src/providers/openai/planner.js';
import { OpenAITtsProvider } from '../src/providers/openai/tts.js';
import { toEditorialInput } from '../src/services/editorialInput.js';
import { planRequest } from './helpers.js';
import { fakeOpenAI, realConfig, responsesBody } from './openaiHelpers.js';

const STRICT_KEYWORDS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'anyOf', 'pattern', 'minItems', 'maxItems', 'description']);

/** Strict Structured Outputs：每個 object 都 additionalProperties:false 且 required 列出全部欄位；只用保守允許的關鍵字。 */
function assertStrictSchema(node: unknown, path = '$'): void {
  if (Array.isArray(node)) return node.forEach((item, i) => assertStrictSchema(item, `${path}[${i}]`));
  if (!node || typeof node !== 'object') return;
  const schema = node as Record<string, unknown>;
  for (const key of Object.keys(schema)) expect(STRICT_KEYWORDS.has(key), `${path}.${key}`).toBe(true);
  if (schema.type === 'object') {
    expect(schema.additionalProperties, path).toBe(false);
    expect([...(schema.required as string[])].sort(), path).toEqual(Object.keys(schema.properties as object).sort());
    for (const [name, child] of Object.entries(schema.properties as object)) assertStrictSchema(child, `${path}.${name}`);
  }
  if (schema.items) assertStrictSchema(schema.items, `${path}.items`);
  if (schema.anyOf) assertStrictSchema(schema.anyOf, `${path}.anyOf`);
}

const signal = () => new AbortController().signal;

it('Responses API：端點、方法、標頭、欄位名稱與 strict json_schema 形狀', async () => {
  const config = realConfig({ OPENAI_MAX_OUTPUT_TOKENS: '3000' });
  const fetchImpl = fakeOpenAI();
  await new OpenAIEditorialPlanner(config.openai, new RealProviderRuntime(config.openai), fetchImpl).draft(toEditorialInput(planRequest()), { signal: signal(), scenario: 'five', attempt: 1 });
  const [url, init] = fetchImpl.mock.calls[0]!;
  expect(url).toBe('https://api.openai.com/v1/responses');
  expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
  expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
  const body = JSON.parse(String(init?.body));
  expect(Object.keys(body).sort()).toEqual(['input', 'max_output_tokens', 'model', 'store', 'text']);
  expect(body).toMatchObject({ model: 'TEST-text', max_output_tokens: 3000, store: false });
  expect(body.input.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
  expect(body.input.every((m: { content: unknown }) => typeof m.content === 'string')).toBe(true);
  expect(Object.keys(body.text)).toEqual(['format']);
  expect(Object.keys(body.text.format).sort()).toEqual(['name', 'schema', 'strict', 'type']);
  expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true });
  expect(body.text.format.name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  expect(body.text.format.schema.type).toBe('object');
  assertStrictSchema(body.text.format.schema);
});

it('Responses 解析：前置 reasoning item、未知欄位可容忍；incomplete（max_output_tokens）視為無效草稿但仍按 usage 結算', async () => {
  const config = realConfig();
  const runtime = new RealProviderRuntime(config.openai);
  const withReasoning = { ...responsesBody('{"ok":1}', { input_tokens: 10, output_tokens: 20 }), output: [{ type: 'reasoning', id: 'rs_1', summary: [] }, ...responsesBody('{"ok":1}').output] };
  const planner = (body: unknown) => new OpenAIEditorialPlanner(config.openai, runtime, fakeOpenAI({ responses: () => Response.json(body) }));
  expect(await planner(withReasoning).draft(toEditorialInput(planRequest()), { signal: signal(), scenario: 'five', attempt: 1 })).toEqual({ ok: 1 });
  const before = runtime.ledger!.snapshot().totalUsd;
  const incomplete = { ...responsesBody('{"ok":', { input_tokens: 10, output_tokens: 4096 }), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } };
  expect(await planner(incomplete).draft(toEditorialInput(planRequest()), { signal: signal(), scenario: 'five', attempt: 1 })).toBeNull();
  expect(runtime.ledger!.snapshot().totalUsd - before).toBeCloseTo((10 * 1 + 4096 * 2) / 1e6, 9);
});

it('Speech API：端點、欄位名稱、mp3、instructions 固定聲線；金鑰只在標頭', async () => {
  const config = realConfig();
  const fetchImpl = fakeOpenAI();
  await new OpenAITtsProvider(config.openai, new RealProviderRuntime(config.openai), fetchImpl).synthesize('晚安，這首歌陪你回家。', signal());
  const [url, init] = fetchImpl.mock.calls[0]!;
  expect(url).toBe('https://api.openai.com/v1/audio/speech');
  expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
  expect(new Headers(init?.headers).get('authorization')).toBe('Bearer TEST-fake-secret');
  const body = JSON.parse(String(init?.body));
  expect(Object.keys(body).sort()).toEqual(['input', 'instructions', 'model', 'response_format', 'voice']);
  expect(body).toEqual({ model: 'TEST-tts', voice: 'TEST-voice', input: '晚安，這首歌陪你回家。', instructions: expect.stringContaining('臺灣國語'), response_format: 'mp3' });
  expect([...body.input].length).toBeLessThanOrEqual(4096);
});
