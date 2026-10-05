import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { ShowPlanSchema, trackKeyOf } from '@qualia/contracts';
import { SessionStore, SESSION_TTL_MS } from '../src/security/sessions.js';
import { filePersistence, memoryPersistence, TasteLedger } from '../src/ledger/tasteStore.js';
import { MockEditorialPlanner } from '../src/providers/mockPlanner.js';
import { ORIGIN, bootstrap, planRequest, postPlan, testApp, testConfig, waitForJob } from './helpers.js';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function files() {
  const dir = mkdtempSync(join(tmpdir(), 'qfm-session-test-'));
  directories.push(dir);
  return { SESSION_STORE_PATH: join(dir, 'sessions.json'), TASTE_LEDGER_PATH: join(dir, 'taste.json') };
}

async function prepare(env: Record<string, string>) {
  const mock = new MockEditorialPlanner();
  const { app } = testApp(env, { planner: { draft: (input, context) => mock.draft(input, context) } });
  const client = await bootstrap(app);
  const session = await client.agent.post('/api/session').set('Origin', ORIGIN).expect(200);
  const cookies = session.headers['set-cookie'];
  if (!cookies) throw new Error('TEST missing cookie');
  const cookie = String(cookies[0]).split(';')[0]!;
  const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  const show = ShowPlanSchema.parse((await client.agent.get(`/api/shows/${job.showId}`)).body);
  return { client, cookie, show, body: { showId: show.showId, segmentId: show.segments[0]!.segmentId, clientRequestId: 'TEST-restart-intent', rating: '愛', reason: 'TEST restart' } };
}

describe('BRA-161 V1：重啟與最小回饋上下文', () => {
  it('重現：只用記憶體時，新進程的舊 cookie feedback 回 401 SESSION_EXPIRED', async () => {
    const { cookie, client, body } = await prepare({});
    const failed = await request(testApp().app).post('/api/feedback').set('Cookie', cookie).set('Origin', ORIGIN).set('X-CSRF-Token', client.csrf).send(body);
    expect(failed.status).toBe(401);
    expect(failed.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('磁碟重載：舊 cookie／CSRF 可回饋 201，重送／再重啟僅有一筆 taste feedback；別人與壞 CSRF 仍被拒', async () => {
    const env = files();
    const { cookie, client, show, body } = await prepare(env);
    const originalLedger = JSON.parse(readFileSync(env.TASTE_LEDGER_PATH, 'utf8'));
    expect(originalLedger.entries.filter((entry: { kind: string }) => entry.kind === 'aired')).toHaveLength(show.segments.length);
    expect(originalLedger.entries.filter((entry: { kind: string }) => entry.kind === 'feedback')).toHaveLength(0);
    const restarted = testApp(env).app; // Fresh SessionStore AND JobStore.
    const post = (app = restarted) => request(app).post('/api/feedback').set('Cookie', cookie).set('Origin', ORIGIN).set('X-CSRF-Token', client.csrf).send(body);
    await post().expect(201);
    await post().expect(201);
    await post(testApp(env).app).expect(201);
    const tasteLedger = new TasteLedger(filePersistence(env.TASTE_LEDGER_PATH));
    const history = await tasteLedger.history(trackKeyOf(show.segments[0]!.candidate.artist, show.segments[0]!.candidate.title), 5);
    expect(history.filter((entry) => entry.kind === 'feedback')).toEqual([expect.objectContaining({ rating: '愛', note: 'TEST restart', showId: show.showId })]);
    const other = await bootstrap(restarted);
    await other.agent.post('/api/feedback').set('Origin', ORIGIN).set('X-CSRF-Token', other.csrf).send(body).expect(404);
    await request(restarted).post('/api/feedback').set('Cookie', cookie).set('Origin', ORIGIN).set('X-CSRF-Token', 'TEST wrong').send(body).expect(403);
    await request(restarted).post('/api/taste/marks').set('Cookie', cookie).set('Origin', ORIGIN).set('X-CSRF-Token', client.csrf)
      .send({ target: { showId: show.showId, segmentId: show.segments[0]!.segmentId }, mark: 'blocked' }).expect(200);
    const saved = JSON.parse(readFileSync(env.SESSION_STORE_PATH, 'utf8'));
    expect(Object.keys(saved.contexts[0].segments[0])).toEqual(['segmentId', 'candidate']);
    expect(Object.keys(saved.contexts[0].segments[0].candidate)).toEqual(['title', 'artist']);
    expect(statSync(env.SESSION_STORE_PATH).mode & 0o777).toBe(0o600);
  });

  it('登出持久撤銷 session 與回饋上下文；重載不復活', async () => {
    const env = files();
    const { client, cookie, body } = await prepare(env);
    await client.agent.post('/api/auth/logout').set('Origin', ORIGIN).set('X-CSRF-Token', client.csrf).expect(204);
    await request(testApp(env).app).post('/api/feedback').set('Cookie', cookie).set('X-CSRF-Token', client.csrf).send(body).expect(401);
    expect(JSON.parse(readFileSync(env.SESSION_STORE_PATH, 'utf8')).contexts).toEqual([]);
  });
});

describe('SessionStore persistence', () => {
  it('維持 12 小時期限，啟動不載入已過期 session；delete 不被重載復活', () => {
    const persistence = memoryPersistence();
    let now = 1_000;
    const first = new SessionStore(persistence, () => now);
    const session = first.create(now);
    expect(new SessionStore(persistence, () => now).get(session.id, now)).toEqual(session);
    now += SESSION_TTL_MS;
    expect(new SessionStore(persistence, () => now).get(session.id, now)).toBeUndefined();
    first.delete(session.id);
    expect(new SessionStore(persistence, () => 1_000).get(session.id, 1_000)).toBeUndefined();
  });

  it('壞檔／不可讀檔拒絕啟動且不覆寫；寫入失敗不回傳有效新 session', () => {
    const env = files();
    writeFileSync(env.SESSION_STORE_PATH, 'TEST broken file');
    expect(() => testApp(env)).toThrow();
    expect(readFileSync(env.SESSION_STORE_PATH, 'utf8')).toBe('TEST broken file');
    expect(() => new SessionStore({ load: () => { throw new Error('TEST EIO'); }, save: () => undefined })).toThrow('Session store is unreadable');
    const sessions = new SessionStore({ load: () => null, save: () => { throw new Error('TEST ENOSPC'); } });
    expect(() => sessions.create(Date.now())).toThrow('Session store write failed');
  });

  it('磁碟寫入失敗回復原狀，既有 session 不會因失敗 delete 被移除', () => {
    const persistence = memoryPersistence();
    let fail = false;
    const backend = { load: persistence.load, save: (body: string) => { if (fail) throw new Error('TEST ENOSPC'); persistence.save(body); } };
    const sessions = new SessionStore(backend, () => 1_000);
    const session = sessions.create(1_000);
    fail = true;
    expect(() => sessions.delete(session.id)).toThrow('Session store write failed');
    expect(sessions.get(session.id, 1_000)).toEqual(session);
    expect(new SessionStore(backend, () => 1_000).get(session.id, 1_000)).toEqual(session);
  });

  it('正式預設用磁碟、test 預設隔離；明確設定路徑轉為絕對路徑', () => {
    expect(testConfig().sessions.path).toBeNull();
    expect(testConfig({ NODE_ENV: 'development' }).sessions.path).toBe(resolve('data/sessions.json'));
    expect(testConfig({ SESSION_STORE_PATH: './data/TEST-session.json' }).sessions.path).toBe(resolve('data/TEST-session.json'));
  });
});
