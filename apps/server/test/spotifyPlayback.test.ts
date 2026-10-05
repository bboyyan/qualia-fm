import { describe, expect, it } from 'vitest';
import { bootstrap, ORIGIN, testApp } from './helpers.js';
import { DJ_TEST_ENV, FakeSpotify, SPOTIFY_TEST_ENV, linkedApp, nominatingPlanner, post, spotifyShow, trackId, trackUri, type LinkedApp } from './spotifyHelpers.js';

const NAMES = [1, 2, 3, 4, 5].map((n) => ({ title: `TEST Song ${n}`, artist: `TEST Artist ${n}` }));

function fakeWithCatalog(): FakeSpotify {
  const fake = new FakeSpotify();
  fake.tracks.push(...NAMES.map((name, i) => ({ id: trackId(i + 1), name: name.title, artists: [name.artist] })));
  return fake;
}

async function djApp(env: Record<string, string> = DJ_TEST_ENV): Promise<LinkedApp> {
  return linkedApp(env, { planner: nominatingPlanner(NAMES) }, fakeWithCatalog());
}

describe('播放代理（路徑 P／C 共用）：伺服器帶 token，指令一律帶 device_id', () => {
  it('play 只接受本 session 節目裡的 URI，送到指定 device_id 並帶起始位置', async () => {
    const dj = await djApp();
    const show = await spotifyShow(dj);
    const uri = show.segments[0]!.track.audioLocator.uri!;
    expect(uri).toBe(trackUri(1));
    await post(dj.client, '/api/spotify/play', { deviceId: 'TESTdeviceP', uri, positionMs: 1500 }).expect(204);
    const [call] = dj.fake.callsTo('PUT', '/v1/me/player/play');
    expect(call?.url.searchParams.get('device_id')).toBe('TESTdeviceP');
    expect(JSON.parse(call?.body ?? '{}')).toEqual({ uris: [uri], position_ms: 1500 });
    const foreign = await post(dj.client, '/api/spotify/play', { deviceId: 'TESTdeviceP', uri: trackUri(99), positionMs: 0 });
    expect([foreign.status, foreign.body.error.code]).toEqual([404, 'NOT_FOUND']);
    expect((await post(dj.client, '/api/spotify/play', { deviceId: 'TESTdeviceP', uri: 'spotify:playlist:x', positionMs: 0 })).status).toBe(400);
    expect((await post(dj.client, '/api/spotify/play', { uri, positionMs: 0 })).status).toBe(400);
  });

  it('404 NO_ACTIVE_DEVICE → DEVICE_UNAVAILABLE 友善訊息，不重試', async () => {
    const dj = await djApp();
    const show = await spotifyShow(dj);
    const res = await post(dj.client, '/api/spotify/play', { deviceId: 'TESTgone', uri: show.segments[0]!.track.audioLocator.uri!, positionMs: 0 });
    expect([res.status, res.body.error.code]).toEqual([409, 'DEVICE_UNAVAILABLE']);
    expect(res.body.error.message).toContain('裝置');
    expect(dj.fake.callsTo('PUT', '/v1/me/player/play')).toHaveLength(1);
  });

  it('403 PREMIUM_REQUIRED → SPOTIFY_ACCOUNT_ERROR；429 → RATE_LIMITED 帶 Retry-After', async () => {
    const dj = await djApp();
    const uri = (await spotifyShow(dj)).segments[0]!.track.audioLocator.uri!;
    dj.fake.respondOnce('PUT', '/v1/me/player/play', 403, { error: { status: 403, message: 'Premium required', reason: 'PREMIUM_REQUIRED' } });
    expect((await post(dj.client, '/api/spotify/play', { deviceId: 'TESTdeviceP', uri, positionMs: 0 })).body.error.code).toBe('SPOTIFY_ACCOUNT_ERROR');
    dj.fake.respondOnce('PUT', '/v1/me/player/play', 429, { error: { status: 429, message: 'slow down' } }, { 'Retry-After': '7' });
    const limited = await post(dj.client, '/api/spotify/play', { deviceId: 'TESTdeviceP', uri, positionMs: 0 });
    expect([limited.status, limited.body.error.code, limited.headers['retry-after']]).toEqual([429, 'RATE_LIMITED', '7']);
  });

  it('access token 過期（401）時換新一次再送', async () => {
    const dj = await djApp();
    const uri = (await spotifyShow(dj)).segments[0]!.track.audioLocator.uri!;
    dj.fake.revokeAccessTokens();
    await post(dj.client, '/api/spotify/play', { deviceId: 'TESTdeviceP', uri, positionMs: 0 }).expect(204);
    expect(dj.fake.callsTo('PUT', '/v1/me/player/play')).toHaveLength(2);
  });

  it('pause 帶 device_id；devices 與 playback 只回最小欄位', async () => {
    const dj = await djApp();
    await post(dj.client, '/api/spotify/pause', { deviceId: 'TESTdeviceP' }).expect(204);
    expect(dj.fake.callsTo('PUT', '/v1/me/player/pause')[0]?.url.searchParams.get('device_id')).toBe('TESTdeviceP');
    dj.fake.devices = [{ id: 'TESTphone', name: 'TEST iPhone', type: 'Smartphone', is_active: true }];
    expect((await dj.client.agent.get('/api/spotify/devices').expect(200)).body).toEqual({ devices: [{ id: 'TESTphone', name: 'TEST iPhone', type: 'Smartphone', isActive: true }] });
    expect((await dj.client.agent.get('/api/spotify/playback').expect(200)).body).toEqual({ deviceId: null, isPlaying: false, uri: null, progressMs: 0, durationMs: null });
    dj.fake.player = { device: { id: 'TESTphone' }, is_playing: true, progress_ms: 4200, item: { uri: trackUri(1), duration_ms: 200000, album: { images: [] } } };
    expect((await dj.client.agent.get('/api/spotify/playback').expect(200)).body).toEqual({ deviceId: 'TESTphone', isPlaying: true, uri: trackUri(1), progressMs: 4200, durationMs: 200000 });
  });

  it('只有 SPOTIFY_ENABLED（E 模式未核可）時，自動播放相關端點一律拒絕', async () => {
    const linked = await djApp(SPOTIFY_TEST_ENV);
    for (const res of [
      await post(linked.client, '/api/spotify/play', { deviceId: 'TESTdeviceP', uri: trackUri(1), positionMs: 0 }),
      await post(linked.client, '/api/spotify/pause', { deviceId: 'TESTdeviceP' }),
      await linked.client.agent.get('/api/spotify/devices'),
      await linked.client.agent.get('/api/spotify/playback'),
    ]) expect([res.status, res.body.error.code]).toEqual([403, 'FEATURE_RESTRICTED']);
    expect(linked.fake.calls.filter((call) => call.url.pathname.startsWith('/v1/me/player'))).toEqual([]);
  });

  it('未連結時播放端點回 FEATURE_RESTRICTED，不會打 Spotify', async () => {
    const fake = new FakeSpotify();
    const client = await bootstrap(testApp({ ...DJ_TEST_ENV, SPOTIFY_TOKEN_FILE: '/nonexistent/qualia/spotify-token.enc' }, { fetchImpl: fake.fetch }).app);
    const res = await client.agent.get('/api/spotify/devices');
    expect([res.status, res.body.error.code]).toEqual([403, 'FEATURE_RESTRICTED']);
    expect(fake.calls).toEqual([]);
  });
});

describe('「愛」→ 加入 Qualia Loved（只加不刪、去重）', () => {
  it('不在歌單 → 加入；URI 由伺服器依節目查，不接受用戶端傳入', async () => {
    const dj = await djApp();
    const show = await spotifyShow(dj);
    const res = await post(dj.client, '/api/spotify/loved', { showId: show.showId, segmentId: show.segments[1]!.segmentId }).expect(200);
    expect(res.body).toEqual({ status: 'added', playlistId: '0dF9anAJZv0IotD6lo2kl2' });
    const [add] = dj.fake.callsTo('POST', '/v1/playlists/0dF9anAJZv0IotD6lo2kl2/items');
    expect(JSON.parse(add?.body ?? '{}')).toEqual({ uris: [trackUri(2)] });
    expect((await post(dj.client, '/api/spotify/loved', { showId: show.showId, segmentId: show.segments[1]!.segmentId, uri: trackUri(9) })).status).toBe(400);
  });

  it('已在歌單（含分頁之後）→ already，不重複加入', async () => {
    const dj = await djApp();
    dj.fake.playlist = [...Array.from({ length: 60 }, (_, i) => trackUri(100 + i)), trackUri(1)];
    const show = await spotifyShow(dj);
    const res = await post(dj.client, '/api/spotify/loved', { showId: show.showId, segmentId: show.segments[0]!.segmentId }).expect(200);
    expect(res.body.status).toBe('already');
    expect(dj.fake.callsTo('POST', '/v1/playlists/0dF9anAJZv0IotD6lo2kl2/items')).toEqual([]);
    expect(dj.fake.callsTo('GET', '/v1/playlists/0dF9anAJZv0IotD6lo2kl2/items')).toHaveLength(2);
  });

  it('同一首並行按兩次只加入一次；從不呼叫刪除', async () => {
    const dj = await djApp();
    const show = await spotifyShow(dj);
    const body = { showId: show.showId, segmentId: show.segments[2]!.segmentId };
    const results = await Promise.all([post(dj.client, '/api/spotify/loved', body), post(dj.client, '/api/spotify/loved', body)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(dj.fake.playlist.filter((uri) => uri === trackUri(3))).toHaveLength(1);
    expect(dj.fake.calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('使用 SPOTIFY_LOVED_PLAYLIST_ID 覆寫的歌單', async () => {
    const dj = await djApp({ ...DJ_TEST_ENV, SPOTIFY_LOVED_PLAYLIST_ID: 'BBBBBBBBBBBBBBBBBBBBBB' });
    const show = await spotifyShow(dj);
    expect((await post(dj.client, '/api/spotify/loved', { showId: show.showId, segmentId: show.segments[0]!.segmentId }).expect(200)).body.playlistId).toBe('BBBBBBBBBBBBBBBBBBBBBB');
  });

  it('沒有 Spotify 對應的段落、別人的節目、未啟用 → 不寫入', async () => {
    const dj = await djApp();
    const show = await spotifyShow(dj);
    expect((await post(dj.client, '/api/spotify/loved', { showId: show.showId, segmentId: 'nope' })).status).toBe(404);
    // 別的 session：BRA-111 起先被擁有者檢查擋下（403），也就碰不到節目（原為 404）。
    const other = await bootstrap(dj.app.app);
    expect((await other.agent.post('/api/spotify/loved').set('Origin', ORIGIN).set('X-CSRF-Token', other.csrf).send({ showId: show.showId, segmentId: show.segments[0]!.segmentId })).status).toBe(403);
    const disabled = await bootstrap(testApp().app);
    expect((await post(disabled, '/api/spotify/loved', { showId: 'x', segmentId: 'y' })).status).toBe(403);
    expect(dj.fake.callsTo('POST', '/v1/playlists/0dF9anAJZv0IotD6lo2kl2/items')).toEqual([]);
  });

  it('只有 SPOTIFY_ENABLED 也可加入 Loved（手動模式的「愛」）', async () => {
    const linked = await djApp(SPOTIFY_TEST_ENV);
    const show = await spotifyShow(linked);
    expect((await post(linked.client, '/api/spotify/loved', { showId: show.showId, segmentId: show.segments[0]!.segmentId }).expect(200)).body.status).toBe('added');
  });
});

describe('中斷連結也清掉記憶體中的 Spotify 資料；CSP 只在啟用時放行 Spotify', () => {
  it('logout 後節目裡的 Spotify ID／封面／外連／URI 都被移除，LLM 提名與回饋仍可用', async () => {
    const dj = await djApp();
    const show = await spotifyShow(dj);
    await post(dj.client, '/api/auth/spotify/logout').expect(204);
    const after = (await dj.client.agent.get(`/api/shows/${show.showId}`).expect(200)).body;
    expect(JSON.stringify(after.segments.map((s: { track: unknown }) => s.track))).not.toMatch(/TESTtrack|i\.scdn\.co|open\.spotify\.com|spotify:track/);
    expect(after.segments[0].candidate.title).toBe('TEST Song 1');
    await post(dj.client, '/api/feedback', { showId: show.showId, segmentId: show.segments[0]!.segmentId, rating: '愛', reason: '' }).expect(201);
  });

  it('預設 CSP 與現況相同（無第三方來源）；啟用後只加入 sdk.scdn.co 與 i.scdn.co', async () => {
    const plain = (await bootstrap(testApp().app)).agent;
    const csp = String((await plain.get('/api/health')).headers['content-security-policy']);
    expect(csp).toBe("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    const enabled = await djApp();
    const spotifyCsp = String((await enabled.client.agent.get('/api/health')).headers['content-security-policy']);
    expect(spotifyCsp).toContain("script-src 'self' https://sdk.scdn.co");
    expect(spotifyCsp).toContain('frame-src https://sdk.scdn.co');
    expect(spotifyCsp).toContain("img-src 'self' data: https://i.scdn.co");
    expect(spotifyCsp).toContain("connect-src 'self';");
  });
});
