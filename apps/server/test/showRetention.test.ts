import { afterEach, it, vi } from 'vitest';
import { JobStore } from '../src/stores/jobStore.js';
import { bootstrap, planRequest, postPlan, testApp, waitForJob } from './helpers.js';

afterEach(() => vi.useRealTimers());

it('建立 show 61 分鐘後再開台，原 show 仍接受延遲回饋', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const client = await bootstrap(testApp().app);
  const first = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  const show = (await client.agent.get(`/api/shows/${first.showId}`)).body;
  vi.setSystemTime(Date.now() + 61 * 60_000);
  await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  await client.agent.post('/api/feedback').set('Origin', 'http://127.0.0.1:5173').set('X-CSRF-Token', client.csrf)
    .send({ showId: show.showId, segmentId: show.segments[0].segmentId, rating: '愛', reason: 'TEST delayed' }).expect(201);
});

it.each(['show', 'feedback', 'plan'] as const)('存取 %s 會延長保留，無存取超過注入保留期才移除', async (access) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const retentionMs = 60_000;
  const { app } = testApp({}, { store: new JobStore(Date.now, retentionMs) });
  const client = await bootstrap(app);
  const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  const show = (await client.agent.get(`/api/shows/${job.showId}`)).body;
  vi.setSystemTime(Date.now() + 50_000);
  if (access === 'show') await client.agent.get(`/api/shows/${job.showId}`).expect(200);
  if (access === 'plan') await client.agent.get(`/api/jobs/${job.jobId}`).expect(200);
  if (access === 'feedback') await client.agent.post('/api/feedback').set('Origin', 'http://127.0.0.1:5173').set('X-CSRF-Token', client.csrf)
    .send({ showId: show.showId, segmentId: show.segments[0].segmentId, rating: '愛', reason: '' }).expect(201);
  vi.setSystemTime(Date.now() + 50_000);
  await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  // 經 API 驗證仍存在，同時更新最後存取時間。
  await client.agent.get(`/api/shows/${show.showId}`).expect(200);
  vi.setSystemTime(Date.now() + retentionMs + 1);
  await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  await client.agent.get(`/api/shows/${show.showId}`).expect(404);
});

it('只透過 job 輪詢（不直接讀 show），跨過多個保留期後 job 與 show 都仍存活', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const retentionMs = 60_000;
  const { app } = testApp({}, { store: new JobStore(Date.now, retentionMs) });
  const client = await bootstrap(app);
  const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  // 每 50 秒只輪詢一次 job，再開新台觸發清理；總時長 150 秒遠超保留期 60 秒。
  for (let i = 0; i < 3; i += 1) {
    vi.setSystemTime(Date.now() + 50_000);
    await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
    await client.agent.get(`/api/jobs/${job.jobId}`).expect(200);
  }
  vi.setSystemTime(Date.now() + 50_000);
  await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  await client.agent.get(`/api/shows/${job.showId}`).expect(200);
});
