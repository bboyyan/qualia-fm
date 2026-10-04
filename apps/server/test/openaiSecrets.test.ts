import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { RealProviderRuntime } from '../src/budget/runtime.js';
import { setLoggerSilent } from '../src/http/log.js';
import { OpenAIEditorialPlanner } from '../src/providers/openai/planner.js';
import { OpenAITtsProvider } from '../src/providers/openai/tts.js';
import { toEditorialInput } from '../src/services/editorialInput.js';
import { ORIGIN, bootstrap, planRequest, postPlan, waitForJob } from './helpers.js';
import { fakeOpenAI, realConfig } from './openaiHelpers.js';

const KEY = 'sk-proj-TEST-CANARY-do-not-leak-0123456789';
let logs: string[] = [];

beforeEach(() => {
  logs = [];
  setLoggerSilent(false);
  for (const stream of [process.stdout, process.stderr]) {
    vi.spyOn(stream, 'write').mockImplementation((chunk: string | Uint8Array) => { logs.push(String(chunk)); return true; });
  }
});
afterEach(() => { setLoggerSilent(true); vi.restoreAllMocks(); });

function expectClean(label: string, value: unknown): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  expect(text, label).not.toContain(KEY);
  expect(text, label).not.toContain('CANARY');
}

it('金鑰只出現在 Authorization 標頭；日誌、錯誤、API 回應、帳本、快取檔名都沒有', async () => {
  const leaky = (status: number) => new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${KEY}` } }), { status });
  for (const scenario of ['throw', '401', '500', 'ok'] as const) {
    const config = realConfig({ OPENAI_API_KEY: KEY });
    const fail = () => { if (scenario === 'throw') throw new Error(`connect failed for ${KEY}`); return leaky(Number(scenario)); };
    const fetchImpl = fakeOpenAI(scenario === 'ok' ? {} : { responses: fail, speech: fail });
    const { app } = createApp(config, { fetchImpl });
    const client = await bootstrap(app);
    const responses: unknown[] = [];
    const created = await postPlan(client, planRequest());
    responses.push(created.body, created.headers);
    const job = await waitForJob(client, created.body.jobId);
    responses.push(job);
    const show = await client.agent.get(`/api/shows/${job.showId}`);
    responses.push(show.body, show.headers, (await client.agent.get('/api/capabilities')).body);
    const segment = show.body.segments[0];
    const tts = await client.agent.post('/api/tts').set('Origin', ORIGIN).set('X-CSRF-Token', client.csrf).send({ showId: job.showId, segmentId: segment.segmentId, variant: 'seed' });
    responses.push(tts.body, tts.headers);
    responses.forEach((value, index) => expectClean(`${scenario} response ${index}`, value));
    expect(fetchImpl).toHaveBeenCalled();
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${KEY}`);
      expectClean(`${scenario} request body`, String(init?.body));
      expectClean(`${scenario} request url`, String(url));
    }
    if (existsSync(config.openai.ledgerPath)) expectClean(`${scenario} ledger`, readFileSync(config.openai.ledgerPath, 'utf8'));
    if (existsSync(config.openai.cacheDir)) expectClean(`${scenario} cache names`, readdirSync(config.openai.cacheDir).join(','));
  }
  expect(logs.length).toBeGreaterThan(0);
  expectClean('logs', logs.join(''));
});

it('直接呼叫 provider 的例外訊息與啟動降級日誌也不含金鑰', async () => {
  const config = realConfig({ OPENAI_API_KEY: KEY });
  const runtime = new RealProviderRuntime(config.openai);
  const boom = async (): Promise<Response> => { throw new Error(`socket ${KEY}`); };
  const errors: unknown[] = [];
  await new OpenAIEditorialPlanner(config.openai, runtime, boom).draft(toEditorialInput(planRequest()), { signal: new AbortController().signal, scenario: 'five', attempt: 1 }).catch((e: unknown) => errors.push(e));
  await new OpenAITtsProvider(config.openai, runtime, boom).synthesize('你好', new AbortController().signal).catch((e: unknown) => errors.push(e));
  expect(errors).toHaveLength(2);
  for (const error of errors) expectClean('error', `${String(error)} ${(error as Error).stack ?? ''} ${JSON.stringify(error)}`);

  createApp(realConfig({ OPENAI_API_KEY: KEY, OPENAI_REAL_CALLS_APPROVED: 'false' }));
  expect(logs.join('')).toContain('openai_disabled');
  expectClean('startup log', logs.join(''));
});
