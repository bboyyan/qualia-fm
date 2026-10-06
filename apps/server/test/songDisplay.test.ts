import { describe, expect, it, vi } from 'vitest';
import { ShowPlanSchema, SongDisplayResponseSchema, trackKeyOf } from '@qualia/contracts';
import { TasteLedger, memoryPersistence } from '../src/ledger/tasteStore.js';
import { TasteService } from '../src/services/tasteService.js';
import { SongDisplayService } from '../src/services/songDisplayService.js';
import { JobStore } from '../src/stores/jobStore.js';
import { bootstrap, testApp, planRequest, postPlan, waitForJob } from './helpers.js';
import { FakeSpotify, SPOTIFY_TEST_ENV, linkedApp, post, trackId } from './spotifyHelpers.js';

const title = '夜行';
const artist = '歌手';
const key = trackKeyOf(artist, title);
const body = { trackKeys: [key] };
const endpoint = '/api/spotify/song-display';
async function ledgerWithSong() {
  const ledger = new TasteLedger(memoryPersistence());
  await new TasteService(ledger, Date.now).edit({ title, artist }, { rating: '愛' });
  return ledger;
}
async function setup() {
  const ledger = await ledgerWithSong();
  const fake = new FakeSpotify();
  fake.tracks.push({ id: trackId(1), name: title, artists: [artist] });
  return { ledger, ...await linkedApp(SPOTIFY_TEST_ENV, { tasteLedger: ledger }, fake) };
}

describe('展示 API（假 Spotify，無真實帳號）', () => {
  it('未啟用：回可辨識的無展示資料，不查網路', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = await bootstrap(testApp({}, { fetchImpl }).app);
    const response = await post(client, endpoint, body).expect(200);
    expect(response.body).toEqual({ items: [{ trackKey: key, status: 'unavailable' }] });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('未連結與非 owner 不查 Spotify，也不透露曲目', async () => {
    const unlinked = testApp(SPOTIFY_TEST_ENV, { fetchImpl: vi.fn<typeof fetch>() });
    expect((await post(await bootstrap(unlinked.app), endpoint, body).expect(200)).body.items[0].status).toBe('unavailable');
    const linked = await setup();
    const other = await bootstrap(linked.app.app);
    const before = linked.fake.calls.length;
    expect((await post(other, endpoint, body).expect(200)).body.items[0].status).toBe('unavailable');
    expect(linked.fake.calls).toHaveLength(before);
  });
  it.each([{ trackKeys: [] }, { trackKeys: Array.from({ length: 11 }, (_, i) => `key${i}`) }, { trackKeys: [key, key] }, { trackKeys: [1] }, { trackKeys: [key], title: '不可信提名' }])('拒絕非法／超額輸入 %j', async (input) => {
    const client = await bootstrap(testApp().app);
    await post(client, endpoint, input).expect(400);
  });
  it('只使用帳本提名，回獨立 metadata，不寫帳本、不回傳 URI 或 provider ID', async () => {
    const { client, ledger, fake } = await setup();
    const before = await ledger.snapshot();
    const record = vi.spyOn(ledger, 'record');
    const result = SongDisplayResponseSchema.parse((await post(client, endpoint, body).expect(200)).body);
    expect(result.items[0]).toMatchObject({ trackKey: key, status: 'available', metadata: { canonicalTitle: title, canonicalArtists: [artist], canonicalAlbum: 'TEST album', artworkUrl: expect.stringContaining('i.scdn.co') } });
    expect(JSON.stringify(result)).not.toMatch(/providerTrackId|audioLocator/);
    expect(fake.callsTo('GET', '/v1/search')).toHaveLength(1);
    expect(record).not.toHaveBeenCalled();
    expect(await ledger.snapshot()).toEqual(before);
    await post(client, endpoint, { trackKeys: ['不在帳本'] }).expect(200);
    expect(fake.callsTo('GET', '/v1/search')).toHaveLength(1);
  });
  it('429 帶 Retry-After 且冷卻期間不重查；解除連結後無資料', async () => {
    const { client, fake } = await setup();
    fake.respondOnce('GET', '/v1/search', 429, {}, { 'Retry-After': '30' });
    const result = await post(client, endpoint, body).expect(429);
    expect(result.body.error.retryAfterMs).toBe(30000);
    await post(client, endpoint, body).expect(429);
    expect(fake.callsTo('GET', '/v1/search')).toHaveLength(1);
    await post(client, '/api/auth/spotify/logout').expect(204);
    expect((await post(client, endpoint, body).expect(200)).body.items[0].status).toBe('unavailable');
  });
});

it('優先重用同 owner、同 candidate key 的已解析曲目', async () => {
  const ledger = await ledgerWithSong();
  const store = new JobStore();
  const client = await bootstrap(testApp().app);
  const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  const plan = ShowPlanSchema.parse((await client.agent.get(`/api/shows/${job.showId}`)).body);
  const track = { provider: 'spotify' as const, providerTrackId: null, canonicalTitle: title, canonicalArtists: [artist], canonicalAlbum: null, artworkUrl: null, durationMs: null, externalUrl: null, availability: 'resolved' as const, canAttemptPlayback: false, audioLocator: { kind: 'none' as const } };
  const segment = plan.segments[0]!;
  const displayPlan = { ...plan, segments: [{ ...segment, candidate: { ...segment.candidate, title, artist }, track }] };
  store.putShow('other', displayPlan, Date.now());
  const resolver = { resolve: vi.fn(async () => ({ ...track, availability: 'unavailable' as const })) };
  const service = new SongDisplayService(new TasteService(ledger, Date.now), store, resolver, Date.now);
  expect((await service.get([key], 'owner', () => true, new AbortController().signal))[0]?.status).toBe('unavailable');
  resolver.resolve.mockClear();
  store.putShow('owner', displayPlan, Date.now());
  expect((await service.get([key], 'owner', () => true, new AbortController().signal))[0]?.status).toBe('available');
  expect(resolver.resolve).not.toHaveBeenCalled();
});

it('解除連結取消在途 resolver，忽略晚到 metadata', async () => {
  const ledger = await ledgerWithSong();
  let finish!: () => void;
  let signal: AbortSignal | undefined;
  const service = new SongDisplayService(new TasteService(ledger, Date.now), new JobStore(), {
    resolve: async (_candidate, context) => {
      signal = context.signal;
      await new Promise<void>((resolve) => { finish = resolve; });
      return { provider: 'spotify', providerTrackId: null, canonicalTitle: title, canonicalArtists: [artist], artworkUrl: null, durationMs: null, externalUrl: null, availability: 'resolved', canAttemptPlayback: false, audioLocator: { kind: 'none' } };
    },
  }, Date.now);
  const pending = service.get([key], 'owner', () => true, new AbortController().signal);
  await vi.waitFor(() => expect(signal).toBeDefined());
  service.clear();
  expect(signal?.aborted).toBe(true);
  finish();
  expect(await pending).toEqual([{ trackKey: key, status: 'unavailable' }]);
});
