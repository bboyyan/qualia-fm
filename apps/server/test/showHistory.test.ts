import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { bootstrap, planRequest, postPlan, testApp, waitForJob } from './helpers.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

it('兩輪已交付開台摘要依時間回看，重建服務及新 session 後仍在，冪等重送不重複', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qfm-history-'));
  dirs.push(dir);
  const path = join(dir, 'history.json');
  const env = { SHOW_HISTORY_PATH: path };
  const client = await bootstrap(testApp(env).app);
  for (const [index, text] of ['雨天散步', '晚安'].entries()) {
    const body = planRequest({ seed: { kind: 'feeling', text, artist: null } });
    const key = `history-plan-${index}`;
    const started = await postPlan(client, body, key).expect(202);
    expect((await waitForJob(client, started.body.jobId)).status).toBe('completed');
    await postPlan(client, body, key).expect(202);
  }
  const first = await client.agent.get('/api/show-history').expect(200);
  expect(first.body.shows).toHaveLength(2);
  expect(first.body.shows.map((show: { seed: { text: string } }) => show.seed.text)).toEqual(['晚安', '雨天散步']);
  expect(first.body.shows[0]).toMatchObject({ trackCount: 5, ttsDegraded: false, speech: 'mock_chime', tracks: expect.any(Array) });
  expect(first.body.shows[0].tracks).toHaveLength(5);
  expect(first.body.shows[0].tracks[0]).toMatchObject({ title: expect.any(String), artist: expect.any(String) });
  const restarted = await bootstrap(testApp(env).app);
  expect((await restarted.agent.get('/api/show-history').expect(200)).body).toEqual(first.body);
  expect(statSync(path).mode & 0o777).toBe(0o600);
});

it('真實 TTS 供應商失敗的語音降級在摘要中明示，DJ 關閉則記未啟用', async () => {
  const { realEnv, fakeOpenAI } = await import('./openaiHelpers.js');
  const env = realEnv({ LLM_PROVIDER: 'mock', TTS_PROVIDER: 'openai' });
  const client = await bootstrap(testApp(env, { fetchImpl: fakeOpenAI({ speech: () => Response.json({ error: {} }, { status: 500 }) }) }).app);
  const first = await postPlan(client, planRequest()).expect(202);
  expect((await waitForJob(client, first.body.jobId)).status).toBe('completed');
  const second = await postPlan(client, planRequest({ dj: { enabled: false, length: 'short' } })).expect(202);
  expect((await waitForJob(client, second.body.jobId)).status).toBe('completed');
  const { shows } = (await client.agent.get('/api/show-history').expect(200)).body;
  expect(shows[0]).toMatchObject({ speech: 'off', ttsDegraded: false });
  expect(shows[1]).toMatchObject({ speech: 'text', ttsDegraded: true });
});

it('歷史需要 session；損毀檔明示錯誤且不覆寫，寫入失敗不交付無紀錄的 show', async () => {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const request = (await import('supertest')).default;
  const dir = mkdtempSync(join(tmpdir(), 'qfm-history-corrupt-'));
  dirs.push(dir);
  const path = join(dir, 'history.json');
  writeFileSync(path, 'broken', { mode: 0o600 });
  const app = testApp({ SHOW_HISTORY_PATH: path }).app;
  await request(app).get('/api/show-history').expect(401);
  const client = await bootstrap(app);
  expect((await client.agent.get('/api/show-history').expect(500)).body.error.message).toContain('無法讀取');
  const started = await postPlan(client, planRequest()).expect(202);
  const job = await waitForJob(client, started.body.jobId);
  expect(job).toMatchObject({ status: 'failed', showId: null });
  expect(readFileSync(path, 'utf8')).toBe('broken');
  const { ShowHistory } = await import('../src/ledger/showHistory.js');
  const unwritable = await bootstrap(testApp({}, { showHistory: new ShowHistory({ load: () => null, save: () => { throw new Error('disk full'); } }) }).app);
  const failed = await postPlan(unwritable, planRequest()).expect(202);
  expect(await waitForJob(unwritable, failed.body.jobId)).toMatchObject({ status: 'failed', showId: null, error: { message: expect.stringContaining('寫入失敗') } });
});

it('失敗或取消的編排不留歷史；零首的已交付摘要仍保留', async () => {
  const client = await bootstrap(testApp().app);
  const failed = await postPlan(client, planRequest(), undefined, 'error').expect(202);
  expect((await waitForJob(client, failed.body.jobId)).status).toBe('failed');
  const slow = await postPlan(client, planRequest(), undefined, 'slow').expect(202);
  await client.agent.delete(`/api/jobs/${slow.body.jobId}`).set('Origin', 'http://127.0.0.1:5173').set('X-CSRF-Token', client.csrf).expect(200);
  expect((await waitForJob(client, slow.body.jobId)).status).toBe('cancelled');
  expect((await client.agent.get('/api/show-history').expect(200)).body.shows).toEqual([]);
  const zero = await postPlan(client, planRequest(), undefined, 'zero').expect(202);
  await waitForJob(client, zero.body.jobId);
  expect((await client.agent.get('/api/show-history').expect(200)).body.shows).toEqual([expect.objectContaining({ trackCount: 0, tracks: [] })]);
});

it('DJ 關閉且語音供應商不可用時，不把未要求的語音記成降級', async () => {
  const { realEnv, fakeOpenAI } = await import('./openaiHelpers.js');
  const client = await bootstrap(testApp(realEnv({ LLM_PROVIDER: 'mock', OPENAI_REAL_CALLS_APPROVED: 'false' }), { fetchImpl: fakeOpenAI() }).app);
  const started = await postPlan(client, planRequest({ dj: { enabled: false, length: 'short' } })).expect(202);
  await waitForJob(client, started.body.jobId);
  const { shows } = (await client.agent.get('/api/show-history').expect(200)).body;
  expect(shows[0]).toMatchObject({ speech: 'off', ttsDegraded: false });
});
