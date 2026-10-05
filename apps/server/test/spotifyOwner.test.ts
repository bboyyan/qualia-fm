import { existsSync, readFileSync } from 'node:fs';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLoggerSilent } from '../src/http/log.js';
import { OwnerNotConfiguredError, SpotifyAuth } from '../src/spotify/auth.js';
import { SpotifyTokenStore } from '../src/spotify/tokenStore.js';
import { testConfig } from './helpers.js';
import { ORIGIN, bootstrap, planRequest, postPlan, testApp, waitForJob, type Client } from './helpers.js';
import { DJ_TEST_ENV, FakeSpotify, linkedApp, nominatingPlanner, post, spotifyShow, tokenFile, trackId, type LinkedApp } from './spotifyHelpers.js';

/**
 * BRA-111 A1：Spotify 連結綁定擁有者。完成登入的那個瀏覽器拿到擁有者憑證（HttpOnly cookie，伺服器只存雜湊於加密 token 檔）；
 * 其他 session（同一網址的其他人／其他裝置）一律不能用這份連結：不能取 SDK token、不能播放、不能寫 Loved、不能中斷或覆蓋連結，
 * 節目也不會替他們送 Spotify Search。
 */

const OWNER_COOKIE = 'qfm_spotify_owner';
const login = (agent: ReturnType<typeof request.agent>) => agent.get('/api/auth/spotify/login').set('Sec-Fetch-Site', 'same-origin');
const stateOf = (location: string): string => new URL(location).searchParams.get('state') ?? '';

afterEach(() => setLoggerSilent(true));

interface Browser {
  readonly get: (path: string) => request.Test;
  readonly post: (path: string, body?: object) => request.Test;
}

/** 模擬「另一個瀏覽器」：新 session，只帶指定的擁有者 cookie（或不帶）。 */
async function browserWith(app: LinkedApp['app'], ownerCookie: string | null): Promise<Browser> {
  const res = await request(app.app).post('/api/session').set('Origin', ORIGIN).expect(200);
  const sid = String((res.headers['set-cookie'] as unknown as string[])[0]).split(';')[0]!;
  const cookie = ownerCookie ? `${sid}; ${OWNER_COOKIE}=${ownerCookie}` : sid;
  const csrf = String(res.body.csrfToken);
  return {
    get: (path) => request(app.app).get(path).set('Cookie', cookie),
    post: (path, body = {}) => request(app.app).post(path).set('Cookie', cookie).set('Origin', ORIGIN).set('X-CSRF-Token', csrf).send(body),
  };
}

const ownerCookieFrom = (res: request.Response): string => {
  const raw = ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).find((c) => c.startsWith(`${OWNER_COOKIE}=`)) ?? '';
  return raw.split(';')[0]!.slice(OWNER_COOKIE.length + 1);
};

/** 擁有者再走一次登入，取得（新的）擁有者 cookie 值。 */
async function relinkOwner(linked: LinkedApp): Promise<string> {
  const started = await login(linked.client.agent).expect(302);
  const res = await linked.client.agent.get(`/callback?code=TEST-code&state=${stateOf(String(started.headers.location))}`).expect(303);
  return ownerCookieFrom(res);
}

const DENIED = [403, 'FEATURE_RESTRICTED'];

describe('擁有者憑證', () => {
  it('完成登入的 /callback 設定擁有者 cookie：HttpOnly、SameSite=Lax、Path=/、長效；token 檔不含 cookie 明文', async () => {
    const fake = new FakeSpotify();
    const file = tokenFile();
    const { app } = testApp({ ...DJ_TEST_ENV, SPOTIFY_TOKEN_FILE: file }, { fetchImpl: fake.fetch });
    const client = await bootstrap(app);
    const state = stateOf(String((await login(client.agent).expect(302)).headers.location));
    const res = await client.agent.get(`/callback?code=TEST-code&state=${state}`).expect(303);
    const cookie = ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).find((c) => c.startsWith(`${OWNER_COOKIE}=`)) ?? '';
    const value = ownerCookieFrom(res);
    expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; SameSite=Lax/);
    expect(cookie).toMatch(/; Path=\//);
    expect(Number(/Max-Age=(\d+)/.exec(cookie)?.[1])).toBeGreaterThanOrEqual(90 * 24 * 3600);
    expect(readFileSync(file, 'utf8')).not.toContain(value);
  });

  it('授權失敗（state 不符）不發擁有者 cookie', async () => {
    const fake = new FakeSpotify();
    const { app } = testApp({ ...DJ_TEST_ENV, SPOTIFY_TOKEN_FILE: tokenFile() }, { fetchImpl: fake.fetch });
    const client = await bootstrap(app);
    const state = stateOf(String((await login(client.agent).expect(302)).headers.location));
    const res = await client.agent.get(`/callback?code=TEST-code&state=${state}x`).expect(303);
    expect(String(res.headers['set-cookie'] ?? '')).not.toContain(OWNER_COOKIE);
  });
});

describe('擁有者可以使用', () => {
  it('token／devices／playback／play／pause／loved 都可用', async () => {
    const linked = await linkedApp(DJ_TEST_ENV, { planner: nominatingPlanner([{ title: 'TEST Song One', artist: 'TEST Artist' }]) });
    linked.fake.tracks.push({ id: trackId(1), name: 'TEST Song One', artists: ['TEST Artist'] });
    const show = await spotifyShow(linked);
    const segment = show.segments.find((s) => s.track.audioLocator.kind === 'spotify_uri')!;
    await post(linked.client, '/api/spotify/token').expect(200);
    await linked.client.agent.get('/api/spotify/devices').expect(200);
    await linked.client.agent.get('/api/spotify/playback').expect(200);
    await post(linked.client, '/api/spotify/play', { deviceId: 'TESTdeviceP', uri: segment.track.audioLocator.uri, positionMs: 0 }).expect(204);
    await post(linked.client, '/api/spotify/pause', { deviceId: 'TESTdeviceP' }).expect(204);
    await post(linked.client, '/api/spotify/loved', { showId: show.showId, segmentId: segment.segmentId }).expect(200);
  });

  it('擁有者換了新 session（舊 session 過期）仍是擁有者：綁的是裝置憑證，不是 session', async () => {
    const linked = await linkedApp(DJ_TEST_ENV);
    const owner = await relinkOwner(linked);
    const fresh = await browserWith(linked.app, owner);
    await fresh.post('/api/spotify/token').expect(200);
    expect((await fresh.get('/api/capabilities').expect(200)).body.spotify).toMatchObject({ linked: true, linkedElsewhere: false });
  });

  it('伺服器重啟（session 全失效）後，擁有者 cookie 仍有效；擁有關係存在加密 token 檔', async () => {
    const linked = await linkedApp(DJ_TEST_ENV);
    const owner = await relinkOwner(linked);
    const restarted = testApp({ ...DJ_TEST_ENV, SPOTIFY_TOKEN_FILE: linked.file }, { fetchImpl: linked.fake.fetch });
    await (await browserWith(restarted, owner)).post('/api/spotify/token').expect(200);
  });
});

describe('非擁有者一律拒絕', () => {
  it.each([
    ['沒有擁有者 cookie', null],
    ['偽造的擁有者 cookie', 'A'.repeat(43)],
    ['格式不對的擁有者 cookie', '..%2F..%2Fetc'],
  ])('%s：token／devices／playback／play／pause／loved／logout 全部 403，且不呼叫 Spotify、不刪 token 檔', async (_name, cookie) => {
    const linked = await linkedApp(DJ_TEST_ENV);
    const browser = await browserWith(linked.app, cookie);
    const before = linked.fake.calls.length;
    const responses = [
      await browser.post('/api/spotify/token'),
      await browser.get('/api/spotify/devices'),
      await browser.get('/api/spotify/playback'),
      await browser.post('/api/spotify/play', { deviceId: 'TESTdeviceP', uri: `spotify:track:${trackId(1)}`, positionMs: 0 }),
      await browser.post('/api/spotify/pause', { deviceId: 'TESTdeviceP' }),
      await browser.post('/api/spotify/loved', { showId: 'show_x', segmentId: 'seg_x' }),
      await browser.post('/api/auth/spotify/logout'),
    ];
    for (const res of responses) expect([res.status, res.body.error?.code]).toEqual(DENIED);
    expect(responses.some((res) => /TEST-access-/.test(JSON.stringify(res.body)))).toBe(false);
    expect(linked.fake.calls.slice(before)).toEqual([]);
    expect(existsSync(linked.file)).toBe(true);
    await post(linked.client, '/api/spotify/token').expect(200);
  });

  it('拒絕訊息說明「只有連結 Spotify 的擁有者能用」，不透露 token 或擁有者資訊', async () => {
    const linked = await linkedApp(DJ_TEST_ENV);
    const res = await (await browserWith(linked.app, null)).post('/api/spotify/token');
    expect(res.body.error.message).toContain('擁有者');
    expect(JSON.stringify(res.body)).not.toMatch(/ownerHash|refresh/i);
  });

  it('capabilities：擁有者 linked=true；其他 session linked=false、linkedElsewhere=true（不能把 E 模式打開）', async () => {
    const linked = await linkedApp(DJ_TEST_ENV);
    expect((await linked.client.agent.get('/api/capabilities')).body.spotify).toMatchObject({ linked: true, linkedElsewhere: false });
    expect((await (await browserWith(linked.app, null)).get('/api/capabilities')).body.spotify).toMatchObject({ linked: false, linkedElsewhere: true });
  });

  it('未連結時：沒有人是擁有者，Spotify 端點一律拒絕，capabilities 兩者皆 false', async () => {
    const fake = new FakeSpotify();
    const { app } = testApp({ ...DJ_TEST_ENV, SPOTIFY_TOKEN_FILE: tokenFile() }, { fetchImpl: fake.fetch });
    const client = await bootstrap(app);
    expect([(await post(client, '/api/spotify/token')).status, (await client.agent.get('/api/spotify/devices')).status]).toEqual([403, 403]);
    expect((await client.agent.get('/api/capabilities')).body.spotify).toMatchObject({ linked: false, linkedElsewhere: false });
    expect(fake.calls).toEqual([]);
  });

  it('中斷連結會清掉擁有者 cookie；原擁有者憑證之後失效', async () => {
    const linked = await linkedApp(DJ_TEST_ENV);
    const owner = await relinkOwner(linked);
    const logout = await post(linked.client, '/api/auth/spotify/logout').expect(204);
    expect(String(logout.headers['set-cookie'] ?? '')).toMatch(new RegExp(`${OWNER_COOKIE}=;[^,]*Max-Age=0`));
    expect((await (await browserWith(linked.app, owner)).post('/api/spotify/token')).status).toBe(403);
  });
});

describe('非擁有者不能覆蓋連結', () => {
  it('已由別人連結時，其他 session 開始登入 → 導回 ?spotify=owner，不產生授權', async () => {
    const linked = await linkedApp(DJ_TEST_ENV);
    const before = linked.fake.calls.length;
    const other = await bootstrap(linked.app.app);
    const res = await login(other.agent);
    expect([res.status, res.headers.location]).toEqual([303, '/?spotify=owner']);
    expect(linked.fake.calls.slice(before)).toEqual([]);
  });

  it('兩人同時開始登入：先完成者成為擁有者，後完成者的回呼被拒絕（不換 token、不覆蓋）', async () => {
    const fake = new FakeSpotify();
    const { app } = testApp({ ...DJ_TEST_ENV, SPOTIFY_TOKEN_FILE: tokenFile() }, { fetchImpl: fake.fetch });
    const first = await bootstrap(app);
    const second = await bootstrap(app);
    const firstState = stateOf(String((await login(first.agent).expect(302)).headers.location));
    const secondState = stateOf(String((await login(second.agent).expect(302)).headers.location));
    await first.agent.get(`/callback?code=TEST-code&state=${firstState}`).expect(303);
    const exchanges = fake.callsTo('POST', '/api/token').length;
    const late = await second.agent.get(`/callback?code=TEST-code&state=${secondState}`);
    expect(late.headers.location).toBe('/?spotify=owner');
    expect(String(late.headers['set-cookie'] ?? '')).not.toContain(OWNER_COOKIE);
    expect(fake.callsTo('POST', '/api/token').length).toBe(exchanges);
    await post(first, '/api/spotify/token').expect(200);
    expect((await post(second, '/api/spotify/token')).status).toBe(403);
  });

  it('擁有者可以重新連結（換新憑證）：舊憑證失效、新憑證可用', async () => {
    const linked = await linkedApp(DJ_TEST_ENV);
    const old = await relinkOwner(linked);
    const renewed = await relinkOwner(linked);
    expect(renewed).not.toBe(old);
    expect((await (await browserWith(linked.app, old)).post('/api/spotify/token')).status).toBe(403);
    await (await browserWith(linked.app, renewed)).post('/api/spotify/token').expect(200);
  });
});

describe('Search 只替擁有者的節目執行', () => {
  const planner = nominatingPlanner([{ title: 'TEST Song One', artist: 'TEST Artist' }]);

  async function planOf(client: Client) {
    const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
    return (await client.agent.get(`/api/shows/${job.showId}`).expect(200)).body as { segments: { track: { audioLocator: { kind: string } } }[] };
  }

  it('非擁有者產生節目：不送 Spotify Search，曲目不帶 spotify_uri', async () => {
    const linked = await linkedApp(DJ_TEST_ENV, { planner });
    linked.fake.tracks.push({ id: trackId(1), name: 'TEST Song One', artists: ['TEST Artist'] });
    const other = await bootstrap(linked.app.app);
    const before = linked.fake.calls.length;
    const show = await planOf(other);
    expect(linked.fake.calls.slice(before)).toEqual([]);
    expect(show.segments.some((s) => s.track.audioLocator.kind === 'spotify_uri')).toBe(false);
  });

  it('擁有者產生節目：照常對應成 spotify_uri（對照組）', async () => {
    const linked = await linkedApp(DJ_TEST_ENV, { planner });
    linked.fake.tracks.push({ id: trackId(1), name: 'TEST Song One', artists: ['TEST Artist'] });
    const show = await planOf(linked.client);
    expect(linked.fake.callsTo('GET', '/v1/search').length).toBeGreaterThan(0);
    expect(show.segments.some((s) => s.track.audioLocator.kind === 'spotify_uri')).toBe(true);
  });
});

describe('日誌不含擁有者憑證', () => {
  it('登入＋使用流程的輸出不含 cookie 值', async () => {
    setLoggerSilent(false);
    const lines: string[] = [];
    const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (lines.push(String(chunk)), true));
    const err = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (lines.push(String(chunk)), true));
    const linked = await linkedApp(DJ_TEST_ENV);
    const owner = await relinkOwner(linked);
    await (await browserWith(linked.app, owner)).post('/api/spotify/token').expect(200);
    await (await browserWith(linked.app, null)).post('/api/spotify/token').expect(403);
    out.mockRestore();
    err.mockRestore();
    expect(lines.join('')).not.toContain(owner);
    expect(lines.join('')).not.toContain(OWNER_COOKIE);
  });
});

describe('擁有者必須是 SPOTIFY_OWNER_USER_ID 指定的 Spotify 帳號（審查必修：先到先得不夠）', () => {
  async function linkAs(meId: string, env: Record<string, string> = DJ_TEST_ENV) {
    const fake = new FakeSpotify();
    fake.meId = meId;
    const file = tokenFile();
    const { app } = testApp({ ...env, SPOTIFY_TOKEN_FILE: file }, { fetchImpl: fake.fetch });
    const client = await bootstrap(app);
    const started = await login(client.agent);
    const state = started.status === 302 ? stateOf(String(started.headers.location)) : '';
    const callback = state ? await client.agent.get(`/callback?code=TEST-code&state=${state}`) : null;
    return { fake, file, client, started, callback };
  }

  it('正確帳號：換到 token 後呼叫一次 /v1/me 比對 id，成為擁有者', async () => {
    const { fake, file, client, callback } = await linkAs('TESTowner');
    expect(callback?.headers.location).toBe('/?spotify=linked');
    const me = fake.callsTo('GET', '/v1/me');
    expect(me).toHaveLength(1);
    expect(me[0]?.authorization).toMatch(/^Bearer TEST-access-/);
    expect(existsSync(file)).toBe(true);
    expect(ownerCookieFrom(callback!)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await post(client, '/api/spotify/token').expect(200);
  });

  it.each([
    ['別的 Spotify 帳號', 'TESTstranger'],
    ['大小寫不同也不算', 'testowner'],
  ])('錯誤帳號（%s）：導回 ?spotify=account，不寫 token 檔、不發擁有者 cookie、之後一律拒絕', async (_name, meId) => {
    const { fake, file, client, callback } = await linkAs(meId);
    expect(callback?.headers.location).toBe('/?spotify=account');
    expect(String(callback?.headers['set-cookie'] ?? '')).not.toContain(OWNER_COOKIE);
    expect(existsSync(file)).toBe(false);
    expect(fake.callsTo('GET', '/v1/me')).toHaveLength(1);
    expect((await client.agent.get('/api/capabilities')).body.spotify).toMatchObject({ linked: false, linkedElsewhere: false });
    expect((await post(client, '/api/spotify/token')).status).toBe(403);
  });

  it('錯誤帳號被拒後，指定帳號仍可以正常連結（不會被佔位）', async () => {
    const fake = new FakeSpotify();
    const file = tokenFile();
    const { app } = testApp({ ...DJ_TEST_ENV, SPOTIFY_TOKEN_FILE: file }, { fetchImpl: fake.fetch });
    const stranger = await bootstrap(app);
    fake.meId = 'TESTstranger';
    const strangerState = stateOf(String((await login(stranger.agent).expect(302)).headers.location));
    expect((await stranger.agent.get(`/callback?code=TEST-code&state=${strangerState}`)).headers.location).toBe('/?spotify=account');
    const owner = await bootstrap(app);
    fake.meId = 'TESTowner';
    const ownerState = stateOf(String((await login(owner.agent).expect(302)).headers.location));
    expect((await owner.agent.get(`/callback?code=TEST-code&state=${ownerState}`)).headers.location).toBe('/?spotify=linked');
    await post(owner, '/api/spotify/token').expect(200);
  });

  it('未設定 SPOTIFY_OWNER_USER_ID：拒絕任何人成為擁有者（fail closed），login 不轉去 Spotify', async () => {
    const { SPOTIFY_OWNER_USER_ID: _unset, ...env } = DJ_TEST_ENV;
    const { fake, file, started, callback } = await linkAs('TESTowner', env);
    expect([started.status, started.headers.location]).toEqual([303, '/?spotify=unconfigured']);
    expect(callback).toBeNull();
    expect(fake.calls).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  it('/v1/me 失敗（Spotify 錯誤）：不寫 token 檔、不發 cookie，導回 ?spotify=error，日誌只記狀態碼', async () => {
    setLoggerSilent(false);
    const lines: string[] = [];
    const err = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (lines.push(String(chunk)), true));
    const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (lines.push(String(chunk)), true));
    const fake = new FakeSpotify();
    fake.respondOnce('GET', '/v1/me', 500, { error: { status: 500 } });
    const file = tokenFile();
    const { app } = testApp({ ...DJ_TEST_ENV, SPOTIFY_TOKEN_FILE: file }, { fetchImpl: fake.fetch });
    const client = await bootstrap(app);
    const state = stateOf(String((await login(client.agent).expect(302)).headers.location));
    const res = await client.agent.get(`/callback?code=TEST-code&state=${state}`);
    err.mockRestore();
    out.mockRestore();
    expect(res.headers.location).toBe('/?spotify=error');
    expect(String(res.headers['set-cookie'] ?? '')).not.toContain(OWNER_COOKIE);
    expect(existsSync(file)).toBe(false);
    expect(lines.join('')).toMatch(/spotify_me_failed[^\n]*500/);
  });

  it('日誌與錯誤回應不含 Spotify 帳號 id、名稱或 email', async () => {
    setLoggerSilent(false);
    const lines: string[] = [];
    const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (lines.push(String(chunk)), true));
    const err = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (lines.push(String(chunk)), true));
    await linkAs('TESTstranger');
    await linkAs('TESTowner');
    out.mockRestore();
    err.mockRestore();
    expect(lines.join('')).not.toMatch(/TESTstranger|TESTowner|TEST Display Name|test-owner@example/);
  });
});

describe('擁有者 cookie 在 HTTPS 部署帶 Secure（審查建議 4）', () => {
  it('APP_ORIGIN 為 https 時，擁有者 cookie 與清除用 cookie 都帶 Secure', async () => {
    const fake = new FakeSpotify();
    const { app } = testApp({ ...DJ_TEST_ENV, SPOTIFY_TOKEN_FILE: tokenFile(), APP_ORIGIN: 'https://qualia.example.test', PORT: '5173' }, { fetchImpl: fake.fetch });
    const session = await request(app).post('/api/session').set('Origin', ORIGIN).expect(200);
    const sid = String((session.headers['set-cookie'] as unknown as string[])[0]).split(';')[0]!;
    const started = await request(app).get('/api/auth/spotify/login').set('Cookie', sid).set('Sec-Fetch-Site', 'same-origin').expect(302);
    const callback = await request(app).get(`/callback?code=TEST-code&state=${stateOf(String(started.headers.location))}`).set('Cookie', sid).expect(303);
    const ownerSetCookie = ((callback.headers['set-cookie'] as unknown as string[] | undefined) ?? []).find((c) => c.startsWith(`${OWNER_COOKIE}=`)) ?? '';
    expect(ownerSetCookie).toMatch(/; Secure/);
    const owner = ownerCookieFrom(callback);
    const logout = await request(app).post('/api/auth/spotify/logout').set('Cookie', `${sid}; ${OWNER_COOKIE}=${owner}`).set('Origin', ORIGIN).set('X-CSRF-Token', String(session.body.csrfToken)).expect(204);
    expect(String(logout.headers['set-cookie'] ?? '')).toMatch(/Max-Age=0; Secure/);
  });

  it('APP_ORIGIN 為 http（本機）時擁有者 cookie 不帶 Secure', async () => {
    const fake = new FakeSpotify();
    const { app } = testApp({ ...DJ_TEST_ENV, SPOTIFY_TOKEN_FILE: tokenFile() }, { fetchImpl: fake.fetch });
    const client = await bootstrap(app);
    const state = stateOf(String((await login(client.agent).expect(302)).headers.location));
    const res = await client.agent.get(`/callback?code=TEST-code&state=${state}`).expect(303);
    const ownerSetCookie = ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).find((c) => c.startsWith(`${OWNER_COOKIE}=`)) ?? '';
    expect(ownerSetCookie).not.toMatch(/Secure/);
  });
});

describe('SpotifyAuth：未設定擁有者帳號時的最後防線', () => {
  it('就算已有 state（例如設定在登入途中被移除），completeLogin 也不換 token、不寫檔', async () => {
    const fake = new FakeSpotify();
    const file = tokenFile();
    const { SPOTIFY_OWNER_USER_ID: _unset, ...env } = DJ_TEST_ENV;
    const config = testConfig({ ...env, SPOTIFY_TOKEN_FILE: file });
    const auth = new SpotifyAuth(config.spotify, new SpotifyTokenStore(file, config.spotify.tokenKey), fake.fetch, Date.now);
    const state = stateOf(auth.beginLogin('TESTsession'));
    await expect(auth.completeLogin('TESTsession', state, 'TEST-code')).rejects.toBeInstanceOf(OwnerNotConfiguredError);
    expect(fake.calls).toEqual([]);
    expect(existsSync(file)).toBe(false);
    expect(auth.ownerConfigured()).toBe(false);
  });
});

