import { cpSync, copyFileSync, existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLoggerSilent } from '../src/http/log.js';
import { ORIGIN, bootstrap, testApp } from './helpers.js';
import { DJ_TEST_ENV, FakeSpotify, SPOTIFY_TEST_ENV, challengeOf, linkedApp, post, tokenFile } from './spotifyHelpers.js';

const login = (agent: ReturnType<typeof request.agent>) => agent.get('/api/auth/spotify/login').set('Sec-Fetch-Site', 'same-origin');
const stateOf = (location: string): string => new URL(location).searchParams.get('state') ?? '';

afterEach(() => setLoggerSilent(true));

describe('Spotify 關閉時（預設）與現況相同', () => {
  it('login／logout／token 一律 FEATURE_RESTRICTED，/callback 不換 token、不轉址', async () => {
    const fake = new FakeSpotify();
    const { app } = testApp({}, { fetchImpl: fake.fetch });
    const client = await bootstrap(app);
    for (const path of ['/api/auth/spotify/login', '/api/auth/spotify/callback?code=x&state=y']) {
      const res = await client.agent.get(path);
      expect([res.status, res.body.error.code]).toEqual([403, 'FEATURE_RESTRICTED']);
    }
    expect((await post(client, '/api/auth/spotify/logout')).status).toBe(403);
    expect((await post(client, '/api/spotify/token')).status).toBe(403);
    expect((await client.agent.get('/callback?code=x&state=y')).status).not.toBe(303);
    expect(fake.calls).toEqual([]);
  });
});

describe('Authorization Code + PKCE', () => {
  it('login 綁 session 後轉到 Spotify authorize：S256 challenge、state、只有白名單 scope、沒有 secret', async () => {
    const { app } = testApp({ ...SPOTIFY_TEST_ENV, SPOTIFY_TOKEN_FILE: tokenFile() });
    const client = await bootstrap(app);
    const res = await login(client.agent).expect(302);
    const url = new URL(String(res.headers.location));
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: SPOTIFY_TEST_ENV.SPOTIFY_CLIENT_ID,
      response_type: 'code',
      redirect_uri: SPOTIFY_TEST_ENV.SPOTIFY_REDIRECT_URI,
      code_challenge_method: 'S256',
    });
    // 鎖定白名單（不引用常數）：Web Playback SDK 必要的 email／private＋播放與 Loved 所需，不多不少。
    expect(url.searchParams.get('scope')?.split(' ')).toEqual(['streaming', 'user-read-email', 'user-read-private', 'user-read-playback-state', 'user-modify-playback-state', 'playlist-modify-private', 'playlist-read-private']);
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(url.searchParams.has('client_secret')).toBe(false);
  });

  it('沒有 session 或跨站觸發 login 不會開始授權', async () => {
    const { app } = testApp({ ...SPOTIFY_TEST_ENV, SPOTIFY_TOKEN_FILE: tokenFile() });
    const anonymous = await request(app).get('/api/auth/spotify/login').set('Sec-Fetch-Site', 'same-origin');
    expect([anonymous.status, anonymous.headers.location]).toEqual([303, '/?spotify=session']);
    const client = await bootstrap(app);
    expect((await client.agent.get('/api/auth/spotify/login').set('Sec-Fetch-Site', 'cross-site')).status).toBe(403);
  });

  it('/callback 驗 state 後以 verifier 換 token，refresh token 加密存檔（600），capabilities 變成已連結', async () => {
    const fake = new FakeSpotify();
    const file = tokenFile();
    const { app } = testApp({ ...SPOTIFY_TEST_ENV, SPOTIFY_TOKEN_FILE: file }, { fetchImpl: fake.fetch });
    const client = await bootstrap(app);
    const authorize = new URL(String((await login(client.agent).expect(302)).headers.location));
    const res = await client.agent.get(`/callback?code=TEST-code&state=${authorize.searchParams.get('state')}`).expect(303);
    expect(res.headers.location).toBe('/?spotify=linked');
    const [exchange] = fake.callsTo('POST', '/api/token');
    const form = new URLSearchParams(exchange?.body ?? '');
    expect(Object.fromEntries(form)).toMatchObject({ grant_type: 'authorization_code', code: 'TEST-code', redirect_uri: SPOTIFY_TEST_ENV.SPOTIFY_REDIRECT_URI, client_id: SPOTIFY_TEST_ENV.SPOTIFY_CLIENT_ID });
    expect(challengeOf(form.get('code_verifier') ?? '')).toBe(authorize.searchParams.get('code_challenge'));
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).not.toMatch(/TEST-(refresh|access)-/);
    expect((await client.agent.get('/api/capabilities').expect(200)).body.spotify.linked).toBe(true);
  });

  it('/api/auth/spotify/callback 別名同樣可用', async () => {
    const fake = new FakeSpotify();
    const { app } = testApp({ ...SPOTIFY_TEST_ENV, SPOTIFY_TOKEN_FILE: tokenFile() }, { fetchImpl: fake.fetch });
    const client = await bootstrap(app);
    const state = stateOf(String((await login(client.agent)).headers.location));
    expect((await client.agent.get(`/api/auth/spotify/callback?code=TEST-code&state=${state}`).expect(303)).headers.location).toBe('/?spotify=linked');
  });

  it.each([
    ['state 不符', (state: string) => `/callback?code=TEST-code&state=${state}x`],
    ['缺 code', (state: string) => `/callback?state=${state}`],
  ])('%s → 不換 token、不連結', async (_name, path) => {
    const fake = new FakeSpotify();
    const { app } = testApp({ ...SPOTIFY_TEST_ENV, SPOTIFY_TOKEN_FILE: tokenFile() }, { fetchImpl: fake.fetch });
    const client = await bootstrap(app);
    const state = stateOf(String((await login(client.agent)).headers.location));
    expect((await client.agent.get(path(state)).expect(303)).headers.location).toBe('/?spotify=error');
    expect(fake.calls).toEqual([]);
    expect((await client.agent.get('/api/capabilities')).body.spotify.linked).toBe(false);
  });

  it('state 只能用一次，也不能被另一個 session 使用，逾時失效', async () => {
    let now = Date.parse('2026-10-05T00:00:00Z');
    const fake = new FakeSpotify();
    const { app } = testApp({ ...SPOTIFY_TEST_ENV, SPOTIFY_TOKEN_FILE: tokenFile() }, { fetchImpl: fake.fetch, now: () => now });
    const owner = await bootstrap(app);
    const other = await bootstrap(app);
    const stolen = stateOf(String((await login(owner.agent)).headers.location));
    expect((await other.agent.get(`/callback?code=TEST-code&state=${stolen}`)).headers.location).toBe('/?spotify=error');
    expect((await owner.agent.get(`/callback?code=TEST-code&state=${stolen}`)).headers.location).toBe('/?spotify=error');
    const late = stateOf(String((await login(owner.agent)).headers.location));
    now += 11 * 60 * 1000;
    expect((await owner.agent.get(`/callback?code=TEST-code&state=${late}`)).headers.location).toBe('/?spotify=error');
    expect(fake.callsTo('POST', '/api/token')).toEqual([]);
  });

  it('使用者在 Spotify 按取消 → denied，不換 token', async () => {
    const fake = new FakeSpotify();
    const { app } = testApp({ ...SPOTIFY_TEST_ENV, SPOTIFY_TOKEN_FILE: tokenFile() }, { fetchImpl: fake.fetch });
    const client = await bootstrap(app);
    const state = stateOf(String((await login(client.agent)).headers.location));
    expect((await client.agent.get(`/callback?error=access_denied&state=${state}`)).headers.location).toBe('/?spotify=denied');
    expect(fake.calls).toEqual([]);
  });

  it('token 交換失敗 → error，不留下檔案', async () => {
    const fake = new FakeSpotify();
    fake.respondOnce('POST', '/api/token', 400, { error: 'invalid_grant' });
    const file = tokenFile();
    const { app } = testApp({ ...SPOTIFY_TEST_ENV, SPOTIFY_TOKEN_FILE: file }, { fetchImpl: fake.fetch });
    const client = await bootstrap(app);
    const state = stateOf(String((await login(client.agent)).headers.location));
    expect((await client.agent.get(`/callback?code=TEST-code&state=${state}`)).headers.location).toBe('/?spotify=error');
    expect(existsSync(file)).toBe(false);
  });

  it('/callback 在 SPA fallback 之前處理', async () => {
    const staticDir = mkdtempSync(join(tmpdir(), 'qualia-spa-'));
    cpSync('apps/web/public', staticDir, { recursive: true });
    copyFileSync('apps/web/index.html', join(staticDir, 'index.html'));
    const fake = new FakeSpotify();
    const { app } = testApp({ ...SPOTIFY_TEST_ENV, SPOTIFY_TOKEN_FILE: tokenFile(), STATIC_DIR: staticDir }, { fetchImpl: fake.fetch });
    const client = await bootstrap(app);
    const state = stateOf(String((await login(client.agent)).headers.location));
    const res = await client.agent.get(`/callback?code=TEST-code&state=${state}`);
    expect([res.status, res.headers.location]).toEqual([303, '/?spotify=linked']);
  });
});

describe('瀏覽器 SDK 用的短期 access token', () => {
  it('需要 session＋CSRF，只在 E 模式核可時下發', async () => {
    const linked = await linkedApp(SPOTIFY_TEST_ENV);
    const res = await post(linked.client, '/api/spotify/token');
    expect([res.status, res.body.error.code]).toEqual([403, 'FEATURE_RESTRICTED']);
    const dj = await linkedApp(DJ_TEST_ENV);
    expect((await dj.client.agent.post('/api/spotify/token').set('Origin', ORIGIN).send({})).status).toBe(403);
    const ok = await post(dj.client, '/api/spotify/token').expect(200);
    expect(ok.body).toEqual({ accessToken: expect.stringMatching(/^TEST-access-/), expiresAt: expect.any(String) });
    expect(ok.headers['cache-control']).toBe('no-store');
  });

  it('過期前自動用 refresh token 換新；Spotify 輪替的 refresh token 會重新加密存檔', async () => {
    let now = Date.parse('2026-10-05T00:00:00Z');
    const fake = new FakeSpotify();
    fake.rotateRefresh = true;
    const dj = await linkedApp(DJ_TEST_ENV, { now: () => now }, fake);
    const first = (await post(dj.client, '/api/spotify/token').expect(200)).body.accessToken;
    expect((await post(dj.client, '/api/spotify/token').expect(200)).body.accessToken).toBe(first);
    const before = readFileSync(dj.file, 'utf8');
    now += 3600 * 1000;
    const second = (await post(dj.client, '/api/spotify/token').expect(200)).body.accessToken;
    expect(second).not.toBe(first);
    expect(new URLSearchParams(fake.callsTo('POST', '/api/token').at(-1)?.body ?? '').get('grant_type')).toBe('refresh_token');
    expect(readFileSync(dj.file, 'utf8')).not.toBe(before);
  });

  it('refresh token 被撤銷 → 刪除檔案（fail closed），提示重新連結', async () => {
    let now = Date.parse('2026-10-05T00:00:00Z');
    const fake = new FakeSpotify();
    const dj = await linkedApp(DJ_TEST_ENV, { now: () => now }, fake);
    now += 3600 * 1000;
    fake.respondOnce('POST', '/api/token', 400, { error: 'invalid_grant' });
    const res = await post(dj.client, '/api/spotify/token');
    expect([res.status, res.body.error.code]).toEqual([403, 'FEATURE_RESTRICTED']);
    expect(existsSync(dj.file)).toBe(false);
    expect((await dj.client.agent.get('/api/capabilities')).body.spotify.linked).toBe(false);
  });
});

describe('中斷 Spotify 連結', () => {
  it('需要 CSRF；成功後刪除 token 檔、capabilities 變未連結、token 端點不再下發', async () => {
    const dj = await linkedApp(DJ_TEST_ENV);
    expect((await dj.client.agent.post('/api/auth/spotify/logout').set('Origin', ORIGIN).send({})).status).toBe(403);
    expect(existsSync(dj.file)).toBe(true);
    await post(dj.client, '/api/auth/spotify/logout').expect(204);
    expect(existsSync(dj.file)).toBe(false);
    expect((await dj.client.agent.get('/api/capabilities')).body.spotify.linked).toBe(false);
    expect((await post(dj.client, '/api/spotify/token')).status).toBe(403);
  });
});

describe('日誌不含 token、code 或 state', () => {
  it('整個登入＋取 token 流程的輸出都沒有敏感值', async () => {
    setLoggerSilent(false);
    const lines: string[] = [];
    const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (lines.push(String(chunk)), true));
    const err = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (lines.push(String(chunk)), true));
    const dj = await linkedApp(DJ_TEST_ENV);
    await post(dj.client, '/api/spotify/token').expect(200);
    out.mockRestore();
    err.mockRestore();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('')).not.toMatch(/TEST-(access|refresh|code)|state=|code=/);
  });
});

describe('PKCE code_verifier（RFC 7636）', () => {
  it('長度 43–128、只含 unreserved 字元，且每次登入都不同', async () => {
    const fake = new FakeSpotify();
    const { app } = testApp({ ...SPOTIFY_TEST_ENV, SPOTIFY_TOKEN_FILE: tokenFile() }, { fetchImpl: fake.fetch });
    const verifiers: string[] = [];
    // 同一個擁有者連續連結兩次（BRA-111 起，別的 session 不能覆蓋已有的連結）。
    const client = await bootstrap(app);
    for (let i = 0; i < 2; i += 1) {
      const state = stateOf(String((await login(client.agent)).headers.location));
      await client.agent.get(`/callback?code=TEST-code&state=${state}`).expect(303);
      verifiers.push(new URLSearchParams(fake.callsTo('POST', '/api/token').at(-1)?.body ?? '').get('code_verifier') ?? '');
    }
    for (const verifier of verifiers) {
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
      expect(verifier).toMatch(/^[A-Za-z0-9._~-]+$/);
    }
    expect(verifiers[0]).not.toBe(verifiers[1]);
  });
});

describe('Spotify 關閉時不建立任何 Spotify 物件（M4b）', () => {
  it('不建立服務、不讀 token 檔，即使檔案路徑已設定；各端點也不觸發讀檔', async () => {
    const { SpotifyTokenStore } = await import('../src/spotify/tokenStore.js');
    const load = vi.spyOn(SpotifyTokenStore.prototype, 'load');
    const save = vi.spyOn(SpotifyTokenStore.prototype, 'save');
    const fake = new FakeSpotify();
    const qualia = testApp({ SPOTIFY_TOKEN_FILE: tokenFile(), SPOTIFY_TOKEN_ENC_KEY: SPOTIFY_TEST_ENV.SPOTIFY_TOKEN_ENC_KEY }, { fetchImpl: fake.fetch });
    expect(qualia.spotify).toBeUndefined();
    const client = await bootstrap(qualia.app);
    await client.agent.get('/api/capabilities').expect(200);
    await post(client, '/api/spotify/token').expect(403);
    await post(client, '/api/spotify/loved', { showId: 'x', segmentId: 'y' }).expect(403);
    await client.agent.get('/api/auth/spotify/login').expect(403);
    expect(load).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(fake.calls).toEqual([]);
    load.mockRestore();
    save.mockRestore();
  });

  it('啟用時才建立服務（對照組）', () => {
    expect(testApp({ ...SPOTIFY_TEST_ENV, SPOTIFY_TOKEN_FILE: tokenFile() }).spotify).toBeDefined();
  });
});

describe('mutation 補測（BRA-111 重跑 PR #6）', () => {
  it('S05：access token 在到期前 60 秒內就先換新（不讓 SDK 拿到快過期的 token）', async () => {
    let now = Date.parse('2026-10-05T00:00:00Z');
    const fake = new FakeSpotify();
    const dj = await linkedApp(DJ_TEST_ENV, { now: () => now }, fake);
    const first = (await post(dj.client, '/api/spotify/token').expect(200)).body.accessToken;
    now += 3600 * 1000 - 61 * 1000;
    expect((await post(dj.client, '/api/spotify/token').expect(200)).body.accessToken).toBe(first);
    now += 2 * 1000;
    expect((await post(dj.client, '/api/spotify/token').expect(200)).body.accessToken).not.toBe(first);
  });

  it('A106：Spotify 輪替 refresh token 時保留擁有者（擁有者仍可用，capabilities 仍為已連結）', async () => {
    let now = Date.parse('2026-10-05T00:00:00Z');
    const fake = new FakeSpotify();
    fake.rotateRefresh = true;
    const dj = await linkedApp(DJ_TEST_ENV, { now: () => now }, fake);
    now += 3600 * 1000;
    await post(dj.client, '/api/spotify/token').expect(200);
    expect(new URLSearchParams(fake.callsTo('POST', '/api/token').at(-1)?.body ?? '').get('grant_type')).toBe('refresh_token');
    now += 3600 * 1000;
    await post(dj.client, '/api/spotify/token').expect(200);
    expect((await dj.client.agent.get('/api/capabilities')).body.spotify.linked).toBe(true);
  });

  it('A111：未連結時中斷連結與 Loved 一律拒絕（沒有擁有者）', async () => {
    const fake = new FakeSpotify();
    const { app } = testApp({ ...DJ_TEST_ENV, SPOTIFY_TOKEN_FILE: tokenFile() }, { fetchImpl: fake.fetch });
    const client = await bootstrap(app);
    const logout = await post(client, '/api/auth/spotify/logout');
    expect([logout.status, logout.body.error?.code]).toEqual([403, 'FEATURE_RESTRICTED']);
    expect(logout.body.error.message).toContain('重新連結');
    expect((await post(client, '/api/spotify/loved', { showId: 'show_x', segmentId: 'seg_x' })).status).toBe(403);
  });
});
