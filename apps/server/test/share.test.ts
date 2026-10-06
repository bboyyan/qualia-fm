import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { SHARE_CODE, ShareFileSchema, ShareViewSchema, trackKeyOf, type CreateShareRequest, type ShareTrack } from '@qualia/contracts';
import { loadShareConfig } from '../src/share/config.js';
import { ORIGIN, bootstrap, testApp, type Client } from './helpers.js';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qfm-share-test-'));
  directories.push(dir);
  return dir;
}

const track = (n: number): ShareTrack => ({ trackKey: trackKeyOf('TEST Artist', `TEST Song ${n}`), title: `TEST Song ${n}`, artist: 'TEST Artist', palette: n % 8 });
const body: CreateShareRequest = { selectionNo: 2, tracks: [1, 2, 3, 4, 5].map(track) };

const createShare = (client: Client, data: unknown = body) =>
  client.agent.post('/api/share').set('Origin', ORIGIN).set('X-CSRF-Token', client.csrf).send(data as object);
const sendEvent = (client: Client, code: string, kind: string) =>
  client.agent.post(`/api/share/${code}/events`).set('Origin', ORIGIN).set('X-CSRF-Token', client.csrf).send({ kind });

describe('BRA-129 分享（session 內）', () => {
  it('建立分享回傳內部短碼與唯讀五首（含 Spotify 單曲搜尋連結），公開連結停用', async () => {
    const client = await bootstrap(testApp().app);
    const res = await createShare(client).expect(201);
    const view = ShareViewSchema.parse(res.body);
    expect(view.code).toMatch(SHARE_CODE);
    expect(view.tracks.map((item) => item.title)).toEqual(['TEST Song 1', 'TEST Song 2', 'TEST Song 3', 'TEST Song 4', 'TEST Song 5']);
    expect(view.tracks[0]!.spotifyUrl).toBe('https://open.spotify.com/search/TEST%20Song%201%20TEST%20Artist');
    expect(view.counts).toEqual({ shared: 1, opened: 0, continued: 0 });
    expect(view.publicLinkEnabled).toBe(false);
  });

  it('同一本精選集再分享沿用同一個短碼，分享次數累加', async () => {
    const client = await bootstrap(testApp().app);
    const first = ShareViewSchema.parse((await createShare(client).expect(201)).body);
    const second = ShareViewSchema.parse((await createShare(client).expect(201)).body);
    expect(second.code).toBe(first.code);
    expect(second.counts.shared).toBe(2);
  });

  it('短碼在同一個 app 的其他已登入 session 也能解析；未知或格式不符的短碼回 404', async () => {
    const { app } = testApp();
    const owner = await bootstrap(app);
    const { code } = ShareViewSchema.parse((await createShare(owner).expect(201)).body);
    const other = await bootstrap(app);
    expect(ShareViewSchema.parse((await other.agent.get(`/api/share/${code}`).expect(200)).body).code).toBe(code);
    expect((await other.agent.get('/api/share/AAAAAAAAAAAA').expect(404)).body.error.code).toBe('NOT_FOUND');
    expect((await other.agent.get('/api/share/..%2F..%2Fetc').expect(404)).body.error.code).toBe('NOT_FOUND');
  });

  it('沒有 session 不能解析或建立；沒有 CSRF 不能建立', async () => {
    const { app } = testApp();
    const owner = await bootstrap(app);
    const { code } = ShareViewSchema.parse((await createShare(owner).expect(201)).body);
    expect((await request(app).get(`/api/share/${code}`).expect(401)).body.error.code).toBe('SESSION_EXPIRED');
    expect((await request(app).post('/api/share').set('Origin', ORIGIN).send(body).expect(401)).body.error.code).toBe('SESSION_EXPIRED');
    expect((await owner.agent.post('/api/share').set('Origin', ORIGIN).send(body).expect(403)).body.error.code).toBe('CSRF_REJECTED');
  });

  it('拒絕不是五首、或夾帶種子原文的請求', async () => {
    const client = await bootstrap(testApp().app);
    expect((await createShare(client, { ...body, tracks: body.tracks.slice(0, 3) }).expect(400)).body.error.code).toBe('INVALID_INPUT');
    expect((await createShare(client, { ...body, seed: 'TEST 私事' }).expect(400)).body.error.code).toBe('INVALID_INPUT');
  });

  it('V3 可量：分享 → 開啟 → 新開台 各自計數', async () => {
    const { app } = testApp();
    const client = await bootstrap(app);
    const { code } = ShareViewSchema.parse((await createShare(client).expect(201)).body);
    await sendEvent(client, code, 'opened').expect(200);
    await sendEvent(client, code, 'opened').expect(200);
    const res = await sendEvent(client, code, 'continued').expect(200);
    expect(res.body).toEqual({ shared: 1, opened: 2, continued: 1 });
    expect(ShareViewSchema.parse((await client.agent.get(`/api/share/${code}`).expect(200)).body).counts).toEqual({ shared: 1, opened: 2, continued: 1 });
    expect((await sendEvent(client, code, 'liked').expect(400)).body.error.code).toBe('INVALID_INPUT');
    expect((await sendEvent(client, 'AAAAAAAAAAAA', 'opened').expect(404)).body.error.code).toBe('NOT_FOUND');
  });
});

describe('BRA-129 分享檔（本機 JSON）', () => {
  it('寫入權限 600 的本機檔，只有五首與計數、沒有種子；重啟後短碼仍可解析', async () => {
    const dir = tempDir();
    const env = { SESSION_STORE_PATH: join(dir, 'sessions.json') };
    const share = { path: join(dir, 'nested', 'share-links.json'), publicEnabled: false };
    const client = await bootstrap(testApp(env, { share }).app);
    const { code } = ShareViewSchema.parse((await createShare(client).expect(201)).body);
    await sendEvent(client, code, 'opened').expect(200);
    expect(statSync(share.path).mode & 0o777).toBe(0o600);
    const raw = readFileSync(share.path, 'utf8');
    const file = ShareFileSchema.parse(JSON.parse(raw));
    expect(file.shares).toHaveLength(1);
    expect(raw).not.toMatch(/seed|TEST fake seed/);

    const restarted = testApp(env, { share }).app;
    const res = await request(restarted).get(`/api/share/${code}`).set('Cookie', await cookieOf(client)).expect(200);
    expect(ShareViewSchema.parse(res.body).counts.opened).toBe(1);
  });

  it('檔案損毀時回錯誤且不覆寫', async () => {
    const dir = tempDir();
    const share = { path: join(dir, 'share-links.json'), publicEnabled: false };
    writeFileSync(share.path, '{not json', { mode: 0o600 });
    const client = await bootstrap(testApp({}, { share }).app);
    expect((await createShare(client).expect(500)).body.error.code).toBe('INTERNAL');
    expect(readFileSync(share.path, 'utf8')).toBe('{not json');
  });
});

describe('BRA-129 公開唯讀路由（L2，feature flag）', () => {
  it('設定預設關閉：SHARE_PUBLIC_ENABLED 未設、空字串或非 true 都是關', () => {
    expect(loadShareConfig({}, 'development').publicEnabled).toBe(false);
    expect(loadShareConfig({ SHARE_PUBLIC_ENABLED: '' }, 'development').publicEnabled).toBe(false);
    expect(loadShareConfig({ SHARE_PUBLIC_ENABLED: 'TRUE' }, 'development').publicEnabled).toBe(false);
    expect(loadShareConfig({ SHARE_PUBLIC_ENABLED: '1' }, 'development').publicEnabled).toBe(false);
    expect(loadShareConfig({ SHARE_PUBLIC_ENABLED: 'true' }, 'development').publicEnabled).toBe(true);
  });

  it('分享檔預設在 data/share-links.json；測試未設定時只用記憶體', () => {
    expect(loadShareConfig({}, 'development').path).toMatch(/data[/\\]share-links\.json$/);
    expect(loadShareConfig({}, 'test').path).toBeNull();
    expect(loadShareConfig({ SHARE_STORE_PATH: '/tmp/TEST-share.json' }, 'test').path).toBe('/tmp/TEST-share.json');
  });

  it('預設關閉：即使短碼存在，不登入或已登入都回 404', async () => {
    const { app } = testApp();
    const client = await bootstrap(app);
    const { code } = ShareViewSchema.parse((await createShare(client).expect(201)).body);
    expect((await request(app).get(`/api/public/share/${code}`).expect(404)).body.error.code).toBe('NOT_FOUND');
    expect((await client.agent.get(`/api/public/share/${code}`).expect(404)).body.error.code).toBe('NOT_FOUND');
    expect((await request(app).get('/api/public/anything').expect(404)).body.error.code).toBe('NOT_FOUND');
  });

  it('只有明確開啟（測試內）才回不含計數的唯讀內容', async () => {
    const { app } = testApp({}, { share: { path: null, publicEnabled: true } });
    const client = await bootstrap(app);
    const view = ShareViewSchema.parse((await createShare(client).expect(201)).body);
    expect(view.publicLinkEnabled).toBe(true);
    const res = await request(app).get(`/api/public/share/${view.code}`).expect(200);
    expect(res.body.tracks).toHaveLength(5);
    expect(res.body.counts).toBeUndefined();
    expect((await request(app).get('/api/public/share/AAAAAAAAAAAA').expect(404)).body.error.code).toBe('NOT_FOUND');
  });
});

async function cookieOf(client: Client): Promise<string> {
  const res = await client.agent.post('/api/session').set('Origin', ORIGIN).expect(200);
  const cookies = res.headers['set-cookie'];
  if (!cookies) throw new Error('TEST missing cookie');
  return String(cookies[0]).split(';')[0]!;
}
