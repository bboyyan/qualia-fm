import { describe, expect, it } from 'vitest';
import type { LedgerRow } from '@qualia/contracts';
import { InMemoryLedger } from '../src/ledger/fake.js';
import { MockEditorialPlanner } from '../src/providers/mockPlanner.js';
import { planRequest, postPlan, waitForJob } from './helpers.js';
import { DJ_TEST_ENV, FakeSpotify, artworkUrl, linkedApp, nominatingPlanner, post, trackId } from './spotifyHelpers.js';

const NAMES = [1, 2, 3, 4, 5].map((n) => ({ title: `TEST Nominated ${n}`, artist: `TEST Artist ${n}` }));
/** Spotify 回傳的正式名稱刻意與 LLM 提名不同，用來證明兩者不會混用。 */
const CANONICAL = (n: number): string => `TEST Nominated ${n} - SpotifyRemaster`;

function catalog(): FakeSpotify {
  const fake = new FakeSpotify();
  fake.tracks.push(...NAMES.map((name, i) => ({ id: trackId(i + 1), name: CANONICAL(i + 1), artists: [name.artist, 'TEST Featured'] })));
  return fake;
}

/** Spotify 端任何可辨識的痕跡：URI、ID、封面、正式名稱、外連、Spotify 字樣。 */
function spotifyTraces(n: number): string[] {
  return ['spotify', trackId(n), artworkUrl(trackId(n)), 'SpotifyRemaster', 'TEST Featured', 'open.spotify.com', 'i.scdn.co'];
}

describe('資料防火牆：Spotify 資料只用於播放與 Loved，不進 LLM、不進帳本', () => {
  it('Search 只把 LLM 提名對應成可播放 URI；段落保留 LLM 原始提名，Spotify 欄位只在 track', async () => {
    const dj = await linkedApp(DJ_TEST_ENV, { planner: nominatingPlanner(NAMES) }, catalog());
    const job = await waitForJob(dj.client, (await postPlan(dj.client, planRequest())).body.jobId);
    const show = (await dj.client.agent.get(`/api/shows/${job.showId}`)).body;
    const first = show.segments[0];
    expect(first.candidate).toMatchObject({ title: 'TEST Nominated 1', artist: 'TEST Artist 1' });
    expect(first.track).toMatchObject({
      provider: 'spotify',
      providerTrackId: trackId(1),
      canonicalTitle: CANONICAL(1),
      canonicalArtists: ['TEST Artist 1', 'TEST Featured'],
      artworkUrl: `${artworkUrl(trackId(1))}-300`,
      externalUrl: `https://open.spotify.com/track/${trackId(1)}`,
      audioLocator: { kind: 'spotify_uri', uri: `spotify:track:${trackId(1)}` },
    });
    const searches = dj.fake.callsTo('GET', '/v1/search');
    expect(searches.map((call) => call.url.searchParams.get('limit'))).toEqual(['5', '5', '5', '5', '5']);
    expect(searches[0]?.url.searchParams.get('type')).toBe('track');
  });

  it('帳本列只有日期／種子／LLM 提名／評價／原因，不含任何 Spotify 欄位', async () => {
    const ledger = new InMemoryLedger();
    const dj = await linkedApp(DJ_TEST_ENV, { planner: nominatingPlanner(NAMES), ledger }, catalog());
    const job = await waitForJob(dj.client, (await postPlan(dj.client, planRequest())).body.jobId);
    const show = (await dj.client.agent.get(`/api/shows/${job.showId}`)).body;
    await post(dj.client, '/api/feedback', { showId: show.showId, segmentId: show.segments[0].segmentId, rating: '愛', reason: 'TEST 空間感對了' }).expect(201);
    const rows: LedgerRow[] = await ledger.read();
    expect(rows).toEqual([{ date: expect.any(String), seed: 'TEST fake seed', recommendation: 'TEST Artist 1 — TEST Nominated 1', rating: '愛', reason: 'TEST 空間感對了' }]);
    expect(Object.keys(rows[0]!).sort()).toEqual(['date', 'rating', 'reason', 'recommendation', 'seed']);
    const serialized = JSON.stringify(rows);
    for (const trace of spotifyTraces(1)) expect(serialized).not.toContain(trace);
  });

  it('下一輪 LLM 輸入（含讀回的帳本）不含任何 Spotify 欄位', async () => {
    const ledger = new InMemoryLedger();
    const seen: unknown[] = [];
    const dj = await linkedApp(DJ_TEST_ENV, { planner: nominatingPlanner(NAMES, seen), ledger }, catalog());
    const first = await waitForJob(dj.client, (await postPlan(dj.client, planRequest())).body.jobId);
    const show = (await dj.client.agent.get(`/api/shows/${first.showId}`)).body;
    for (const segment of show.segments) {
      await post(dj.client, '/api/feedback', { showId: show.showId, segmentId: segment.segmentId, rating: '愛', reason: '' }).expect(201);
    }
    await waitForJob(dj.client, (await postPlan(dj.client, planRequest())).body.jobId);
    expect(seen).toHaveLength(2);
    const second = JSON.stringify(seen[1]);
    expect(second).toContain('TEST Nominated 1');
    for (let n = 1; n <= 5; n += 1) for (const trace of spotifyTraces(n)) expect(second).not.toContain(trace);
  });

  it('MOCK 選歌（虛構曲名）時不送 Search，曲目維持 MOCK 測試音', async () => {
    const fake = catalog();
    const dj = await linkedApp(DJ_TEST_ENV, { planner: new MockEditorialPlanner() }, fake);
    const job = await waitForJob(dj.client, (await postPlan(dj.client, planRequest())).body.jobId);
    const show = (await dj.client.agent.get(`/api/shows/${job.showId}`)).body;
    expect(fake.callsTo('GET', '/v1/search')).toEqual([]);
    expect(show.segments.every((s: { track: { provider: string } }) => s.track.provider === 'mock')).toBe(true);
  });

  it('找不到對應或不可播 → 換下一位候選；Search 失敗不讓整輪失敗', async () => {
    const fake = catalog();
    fake.tracks.splice(1, 1, { id: trackId(2), name: CANONICAL(2), artists: ['TEST Someone Else'] });
    fake.tracks.splice(2, 1, { id: trackId(3), name: CANONICAL(3), artists: ['TEST Artist 3'], playable: false });
    const names = [...NAMES, { title: 'TEST Nominated 6', artist: 'TEST Artist 6' }, { title: 'TEST Nominated 7', artist: 'TEST Artist 7' }];
    fake.tracks.push({ id: trackId(6), name: CANONICAL(6), artists: ['TEST Artist 6'] }, { id: trackId(7), name: CANONICAL(7), artists: ['TEST Artist 7'] });
    const dj = await linkedApp(DJ_TEST_ENV, { planner: nominatingPlanner(names) }, fake);
    const job = await waitForJob(dj.client, (await postPlan(dj.client, planRequest())).body.jobId);
    const show = (await dj.client.agent.get(`/api/shows/${job.showId}`)).body;
    expect(show.segments.map((s: { candidate: { title: string } }) => s.candidate.title)).toEqual(['TEST Nominated 1', 'TEST Nominated 4', 'TEST Nominated 5', 'TEST Nominated 6', 'TEST Nominated 7']);
    expect(show.unavailable.map((c: { title: string }) => c.title)).toEqual(['TEST Nominated 2', 'TEST Nominated 3']);

    const failing = catalog();
    for (let i = 0; i < 7; i += 1) failing.respondOnce('GET', '/v1/search', 503, { error: { status: 503, message: 'TEST down' } });
    const down = await linkedApp(DJ_TEST_ENV, { planner: nominatingPlanner(NAMES) }, failing);
    const partial = await waitForJob(down.client, (await postPlan(down.client, planRequest())).body.jobId);
    expect(partial.status).toBe('partial');
    const empty = (await down.client.agent.get(`/api/shows/${partial.showId}`)).body;
    expect(empty.warnings.join('\n')).toContain('Spotify 對應暫時失敗');
  });
});
