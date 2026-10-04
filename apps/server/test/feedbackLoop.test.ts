import { expect, it } from 'vitest';
import { InMemoryLedger } from '../src/ledger/fake.js';
import { MockEditorialPlanner } from '../src/providers/mockPlanner.js';
import type { EditorialInput } from '../src/services/editorialInput.js';
import { bootstrap, planRequest, postPlan, testApp, waitForJob } from './helpers.js';

it('V4 waits for ledger before planner and includes the saved rating and reason on every round', async () => {
  const ledger = new InMemoryLedger();
  await ledger.append({ date: '2026-10-04T00:00:00.000Z', seed: 'TEST seed', recommendation: 'TEST recommendation', rating: '愛', reason: 'TEST reason' });
  let release!: () => void;
  const waiting = new Promise<void>((r) => { release = r; });
  const inputs: EditorialInput[] = [];
  const mock = new MockEditorialPlanner();
  const client = await bootstrap(testApp({}, {
    ledger: { append: (row) => ledger.append(row), read: async () => { await waiting; return ledger.read(); } },
    planner: { draft: async (input, context) => { inputs.push(input); return mock.draft(input, context); } },
  }).app);
  const first = await postPlan(client, planRequest());
  await new Promise((r) => setTimeout(r, 20));
  expect(inputs).toHaveLength(0);
  release();
  await waitForJob(client, first.body.jobId);
  await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  expect(inputs).toHaveLength(2);
  expect(inputs.map((input) => input.history)).toEqual([await ledger.read(), await ledger.read()]);
});

it('V4 ledger failure completes with only confirmed seed and an explicit warning', async () => {
  const inputs: EditorialInput[] = [];
  const mock = new MockEditorialPlanner();
  const client = await bootstrap(testApp({}, {
    ledger: { append: async () => { throw new Error('TEST'); }, read: async () => { throw new Error('TEST unavailable'); } },
    planner: { draft: async (input, context) => { inputs.push(input); return mock.draft(input, context); } },
  }).app);
  const job = await waitForJob(client, (await postPlan(client, { ...planRequest(), tuning: 'TEST tuning' })).body.jobId);
  expect(job.status).toBe('completed');
  expect(inputs[0]).toMatchObject({ seedKind: 'song', seedText: 'Time Flows Ever Onward', seedArtist: 'Evan Call', tuning: null, history: [] });
  const show = await client.agent.get(`/api/shows/${job.showId}`);
  expect(show.body.warnings).toContain('未讀到帳本：本輪只用種子曲。');
});

it('V1 feedback API records five fields and empty reason, rejects invalid rating and unowned show', async () => {
  const ledger = new InMemoryLedger();
  const app = testApp({}, { ledger }).app;
  const client = await bootstrap(app);
  const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  const show = (await client.agent.get(`/api/shows/${job.showId}`)).body;
  const body = { showId: show.showId, segmentId: show.segments[0].segmentId, rating: '愛', reason: '' };
  const send = (data: object) => client.agent.post('/api/feedback').set('Origin', 'http://127.0.0.1:5173').set('X-CSRF-Token', client.csrf).send(data);
  const receipt = await send(body);
  expect(receipt.status).toBe(201);
  expect(receipt.body.mode).toBe('fake');
  expect(await ledger.read()).toEqual([{ date: expect.any(String), seed: show.seed.text, recommendation: `${show.segments[0].candidate.artist} — ${show.segments[0].candidate.title}`, rating: '愛', reason: '' }]);
  expect((await send({ ...body, rating: 'TEST invalid' })).status).toBe(400);
  expect((await send({ ...body, showId: 'TEST nonexistent' })).status).toBe(404);
  const other = await bootstrap(app);
  expect((await other.agent.post('/api/feedback').set('Origin', 'http://127.0.0.1:5173').set('X-CSRF-Token', other.csrf).send(body)).status).toBe(404);
});

it('saved fake feedback enters the next planner call through the ledger read', async () => {
  const inputs: EditorialInput[] = [];
  const mock = new MockEditorialPlanner();
  const client = await bootstrap(testApp({}, {
    ledger: new InMemoryLedger(),
    planner: { draft: async (input, context) => { inputs.push(input); return mock.draft(input, context); } },
  }).app);
  const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  const show = (await client.agent.get(`/api/shows/${job.showId}`)).body;
  await client.agent.post('/api/feedback').set('Origin', 'http://127.0.0.1:5173').set('X-CSRF-Token', client.csrf).send({ showId: show.showId, segmentId: show.segments[0].segmentId, rating: '不對', reason: 'TEST fake reason' }).expect(201);
  await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  expect(inputs[0]?.history).toEqual([]);
  expect(inputs[1]?.history).toEqual([{ date: expect.any(String), seed: 'TEST fake seed', recommendation: expect.stringContaining('Qualia Mock'), rating: '不對', reason: 'TEST fake reason' }]);
});

// 同一意圖重送（含同時到達）只能產生一列，舊客戶端也依曲目去重。
it.each([undefined, 'TEST-feedback-intent'])('回饋重送回傳相同收據且帳本只有一列：%s', async (clientRequestId) => {
  const ledger = new InMemoryLedger();
  const client = await bootstrap(testApp({}, { ledger }).app);
  const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  const show = (await client.agent.get(`/api/shows/${job.showId}`)).body;
  const body = { showId: show.showId, segmentId: show.segments[0].segmentId, rating: '愛', reason: 'TEST', clientRequestId };
  const send = () => client.agent.post('/api/feedback').set('Origin', 'http://127.0.0.1:5173').set('X-CSRF-Token', client.csrf).send(body);
  const [first, second] = await Promise.all([send(), send()]);
  expect([first.status, second.status]).toEqual([201, 201]);
  expect(second.body).toEqual(first.body);
  expect((await send()).body).toEqual(first.body);
  expect(await ledger.read()).toHaveLength(1);
});

it.each([undefined, 'TEST-shared-intent'])('同一 show 的兩個 segment 各自記一列，各自重送仍只有兩列：%s', async (clientRequestId) => {
  const ledger = new InMemoryLedger();
  const client = await bootstrap(testApp({}, { ledger }).app);
  const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  const show = (await client.agent.get(`/api/shows/${job.showId}`)).body;
  const [a, b] = show.segments;
  const send = (segmentId: string) => client.agent.post('/api/feedback').set('Origin', 'http://127.0.0.1:5173').set('X-CSRF-Token', client.csrf)
    .send({ showId: show.showId, segmentId, rating: '愛', reason: 'TEST', clientRequestId }).expect(201);
  const firstA = await send(a.segmentId);
  const firstB = await send(b.segmentId);
  expect(await ledger.read()).toHaveLength(2);
  expect((await send(a.segmentId)).body).toEqual(firstA.body);
  expect((await send(b.segmentId)).body).toEqual(firstB.body);
  expect((await ledger.read()).map((row) => row.recommendation)).toEqual([
    `${a.candidate.artist} — ${a.candidate.title}`,
    `${b.candidate.artist} — ${b.candidate.title}`,
  ]);
});

it('存在的 show 搭配不存在的 segment 回 404，且不寫帳本', async () => {
  const ledger = new InMemoryLedger();
  const client = await bootstrap(testApp({}, { ledger }).app);
  const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  await client.agent.get(`/api/shows/${job.showId}`).expect(200);
  await client.agent.post('/api/feedback').set('Origin', 'http://127.0.0.1:5173').set('X-CSRF-Token', client.csrf)
    .send({ showId: job.showId, segmentId: 'TEST-missing-segment', rating: '愛', reason: '' }).expect(404);
  expect(await ledger.read()).toEqual([]);
});
