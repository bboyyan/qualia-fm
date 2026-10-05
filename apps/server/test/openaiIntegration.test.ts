import { writeFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { MockEditorialPlanner } from '../src/providers/mockPlanner.js';
import { createApp } from '../src/app.js';
import { realConfig } from './openaiHelpers.js';
import { bootstrap, planRequest, postPlan, waitForJob } from './helpers.js';

beforeEach(() => { vi.stubGlobal('fetch', () => { throw new Error('禁止真實網路'); }); });
it('啟用後 API plan 與 AI 音訊可使用假 fetch，標示 aiVoice，音訊需本人 session', async () => {
  const config = realConfig({ MOCK_PHASE_MS: '0' });
  const draft = await new MockEditorialPlanner().draft({ seedText: 'TEST', seedKind: 'feeling', seedArtist: null, history: [], tuning: null, djEnabled: true, djLength: 'short', recentPicks: [], exploration: 0 }, { signal: new AbortController().signal, attempt: 1, scenario: 'five' });
  const fetchImpl = vi.fn<typeof fetch>(async (url) => String(url).endsWith('/responses') ? Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(draft) }] }], usage: { input_tokens: 100, output_tokens: 100 } }) : new Response(new Uint8Array([1, 2, 3])));
  const { app } = createApp(config, { fetchImpl });
  const client = await bootstrap(app);
  expect((await client.agent.get('/api/capabilities')).body.providers).toMatchObject({ llm: 'openai', tts: 'openai', reason: null });
  const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  const show = (await client.agent.get(`/api/shows/${job.showId}`)).body;
  expect(show.segments[0].speech).toMatchObject({ kind: 'ai_audio', aiVoice: true });
  const audio = await client.agent.get(show.segments[0].speech.url).expect(200);
  expect(audio.headers['content-type']).toContain('audio/mpeg');
  const other = await bootstrap(app);
  await other.agent.get(show.segments[0].speech.url).expect(404);
});
it('未簽收、缺 key、損毀帳本與動態停止檔皆明示降級且不發請求', async () => {
  for (const kind of ['key', 'approval', 'ledger', 'kill']) {
    const config = realConfig(kind === 'key' ? { OPENAI_API_KEY: '' } : kind === 'approval' ? { OPENAI_REAL_CALLS_APPROVED: 'false' } : {});
    if (kind === 'ledger') writeFileSync(config.openai.ledgerPath, '{}');
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = createApp(config, { fetchImpl });
    if (kind === 'kill') writeFileSync(config.openai.killSwitchFile, 'stop');
    const client = await bootstrap(app);
    expect((await client.agent.get('/api/capabilities')).body.providers.reason).toBeTruthy();
    const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
    expect(job.status).toBe('completed');
    expect(fetchImpl).not.toHaveBeenCalled();
  }
});
it('TTS API 僅使用已擁有節目的台詞，忽略任意 voice；快取不重複計費', async () => {
  const config = realConfig({ LLM_PROVIDER: 'mock' });
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3])));
  const { app } = createApp(config, { fetchImpl });
  const client = await bootstrap(app);
  const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  const show = (await client.agent.get(`/api/shows/${job.showId}`)).body;
  const count = fetchImpl.mock.calls.length;
  const response = await client.agent.post('/api/tts').set('Origin', 'http://127.0.0.1:5173').set('X-CSRF-Token', client.csrf).send({ showId: job.showId, segmentId: show.segments[0].segmentId, variant: 'seed', voiceId: 'arbitrary' }).expect(200);
  expect(response.body).toMatchObject({ aiVoice: true, kind: 'ai_audio', url: show.segments[0].speech.url });
  expect(fetchImpl).toHaveBeenCalledTimes(count);
});
it('每日 plan 上限也適用僅啟用 TTS，拒絕整輪真實供應商並明示降級', async () => {
  const config = realConfig({ LLM_PROVIDER: 'mock', BUDGET_MAX_PLANS_PER_DAY: '1' });
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1])));
  const { app } = createApp(config, { fetchImpl });
  const client = await bootstrap(app);
  const first = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  expect((await client.agent.get(`/api/shows/${first.showId}`)).body.segments[0].speech.aiVoice).toBe(true);
  const second = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  const show = (await client.agent.get(`/api/shows/${second.showId}`)).body;
  expect(show.segments[0].speech.kind).toBe('mock_chime');
  expect(show.warnings.join(' ')).toContain('預算');
});
it('無效 JSON 仍由 PlanService 驗證，最多兩次 LLM 呼叫，不把輸出當成有效節目（改用明示的 MOCK 降級）', async () => {
  const config = realConfig({ TTS_PROVIDER: 'mock' });
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{broken' }] }], usage: { input_tokens: 1, output_tokens: 1 } }));
  const { app } = createApp(config, { fetchImpl });
  const client = await bootstrap(app);
  const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  expect(job.status).toBe('completed');
  expect((await client.agent.get(`/api/shows/${job.showId}`)).body.warnings[0]).toContain('MOCK 示範');
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
