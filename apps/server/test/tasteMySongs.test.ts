import { describe, expect, it } from 'vitest';
import { PINNED_LIMIT, ShowPlanSchema, TASTE_HISTORY_LIMIT, TasteHistoryResponseSchema, trackKeyOf, type ShowPlan } from '@qualia/contracts';
import { TasteLedger, memoryPersistence } from '../src/ledger/tasteStore.js';
import { TasteService } from '../src/services/tasteService.js';
import { ORIGIN, bootstrap, planRequest, postPlan, testApp, waitForJob, type Client } from './helpers.js';

/** BRA-135「我的歌」用到的品味帳本 API：釘選上限與單曲帳本紀錄。 */

const post = (client: Client, path: string, body: object) =>
  client.agent.post(path).set('Origin', ORIGIN).set('X-CSRF-Token', client.csrf).send(body);

async function newShow(client: Client): Promise<ShowPlan> {
  const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  return ShowPlanSchema.parse((await client.agent.get(`/api/shows/${job.showId}`).expect(200)).body);
}

const keyOf = (show: ShowPlan, index: number): string => {
  const candidate = show.segments[index]!.candidate;
  return trackKeyOf(candidate.artist, candidate.title);
};

/** 用回饋把節目前 count 首寫進帳本，回傳它們的 trackKey。 */
async function rateFirst(client: Client, show: ShowPlan, count: number): Promise<string[]> {
  for (const segment of show.segments.slice(0, count)) {
    await post(client, '/api/feedback', { showId: show.showId, segmentId: segment.segmentId, rating: '還行', reason: '' }).expect(201);
  }
  return show.segments.slice(0, count).map((_, index) => keyOf(show, index));
}

async function setup(): Promise<{ client: Client; show: ShowPlan }> {
  const client = await bootstrap(testApp({}, { tasteLedger: new TasteLedger(memoryPersistence()) }).app);
  return { client, show: await newShow(client) };
}

describe('釘選上限（POST /api/taste/marks）', () => {
  it('已有一首釘選時併發釘兩首不同歌：只成功一筆，另一筆 409，且失敗不堵住後續編輯', async () => {
    const ledger = new TasteLedger(memoryPersistence());
    const service = new TasteService(ledger, Date.now);
    const tracks = ['a', 'b', 'c'].map((title) => ({ title, artist: 'artist' }));
    await service.edit(tracks[0]!, { mark: 'pinned' });
    const results = await Promise.allSettled(tracks.slice(1).map((track) => service.edit(track, { mark: 'pinned' })));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toEqual([
      { status: 'rejected', reason: expect.objectContaining({ code: 'PIN_LIMIT_REACHED', status: 409 }) },
    ]);
    expect((await ledger.marks()).filter((mark) => mark.mark === 'pinned')).toHaveLength(2);
    await service.edit(tracks[0]!, { mark: null });
    const refused = tracks[results[0]!.status === 'rejected' ? 1 : 2]!;
    await expect(service.edit(refused, { mark: 'pinned' })).resolves.toMatchObject({ mark: 'pinned' });
    expect((await ledger.marks()).filter((mark) => mark.mark === 'pinned')).toHaveLength(2);
  });

  it('舊帳本已有三首釘選：重送既有釘選成功，只擋新增', async () => {
    const ledger = new TasteLedger(memoryPersistence());
    const tracks = ['a', 'b', 'c'].map((title) => ({ title, artist: 'artist', trackKey: trackKeyOf('artist', title) }));
    await ledger.record(tracks.map((track, index) => ({ ...track, kind: 'mark', mark: 'pinned', entryId: `old-mark-${index}`, at: '2026-10-05T12:00:00.000Z' })));
    const client = await bootstrap(testApp({}, { tasteLedger: ledger }).app);
    await post(client, '/api/taste/marks', { target: { trackKey: tracks[0]!.trackKey }, mark: 'pinned' }).expect(200);
    const service = new TasteService(ledger, Date.now);
    await expect(service.edit({ title: 'd', artist: 'artist' }, { mark: 'pinned' })).rejects.toMatchObject({ code: 'PIN_LIMIT_REACHED', status: 409 });
    expect((await ledger.marks()).filter((mark) => mark.mark === 'pinned')).toHaveLength(3);
  });

  it(`上限 ${PINNED_LIMIT} 首：滿了再釘回 409 PIN_LIMIT_REACHED，訊息說明上限與下一步`, async () => {
    const { client, show } = await setup();
    const keys = await rateFirst(client, show, PINNED_LIMIT + 1);
    for (const trackKey of keys.slice(0, PINNED_LIMIT)) await post(client, '/api/taste/marks', { target: { trackKey }, mark: 'pinned' }).expect(200);
    const refused = await post(client, '/api/taste/marks', { target: { trackKey: keys[PINNED_LIMIT] }, mark: 'pinned' });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: 'PIN_LIMIT_REACHED', retryable: false, message: expect.stringContaining(`${PINNED_LIMIT} 首`) });
    const marks = (await client.agent.get('/api/taste/marks').expect(200)).body.marks as { mark: string | null }[];
    expect(marks.filter((mark) => mark.mark === 'pinned')).toHaveLength(PINNED_LIMIT);
  });

  it('已釘選的歌再送一次釘選不算新增；取消或改封鎖後騰出名額', async () => {
    const { client, show } = await setup();
    const keys = await rateFirst(client, show, PINNED_LIMIT + 1);
    for (const trackKey of keys.slice(0, PINNED_LIMIT)) await post(client, '/api/taste/marks', { target: { trackKey }, mark: 'pinned' }).expect(200);
    await post(client, '/api/taste/marks', { target: { trackKey: keys[0] }, mark: 'pinned' }).expect(200);
    await post(client, '/api/taste/marks', { target: { trackKey: keys[0] }, mark: 'blocked' }).expect(200);
    await post(client, '/api/taste/marks', { target: { trackKey: keys[PINNED_LIMIT] }, mark: 'pinned' }).expect(200);
  });

  it('只改評價（收藏）不受釘選上限影響', async () => {
    const { client, show } = await setup();
    const keys = await rateFirst(client, show, PINNED_LIMIT + 1);
    for (const trackKey of keys.slice(0, PINNED_LIMIT)) await post(client, '/api/taste/marks', { target: { trackKey }, mark: 'pinned' }).expect(200);
    const loved = await post(client, '/api/taste/marks', { target: { trackKey: keys[PINNED_LIMIT] }, rating: '愛' }).expect(200);
    expect(loved.body).toMatchObject({ rating: '愛', mark: null });
  });
});

describe('單曲帳本紀錄（GET /api/taste/history）', () => {
  it(`只回這首的紀錄，新到舊，最多 ${TASTE_HISTORY_LIMIT} 筆`, async () => {
    const { client, show } = await setup();
    const [first, second] = await rateFirst(client, show, 2);
    const edits = [{ rating: '愛' }, { mark: 'pinned' }, { mark: null }, { rating: '不對', note: '太吵' }, { mark: 'blocked' }, { mark: null }];
    for (const edit of edits) await post(client, '/api/taste/marks', { target: { trackKey: first }, ...edit }).expect(200);
    const res = await client.agent.get('/api/taste/history').query({ trackKey: first }).expect(200);
    const { entries } = TasteHistoryResponseSchema.parse(res.body);
    expect(entries).toHaveLength(TASTE_HISTORY_LIMIT);
    expect(entries.every((entry) => entry.trackKey === first)).toBe(true);
    expect(entries.map((entry) => entry.at)).toEqual([...entries.map((entry) => entry.at)].sort().reverse());
    expect(entries[0]).toMatchObject({ kind: 'mark', mark: null });
    expect(entries.some((entry) => entry.trackKey === second)).toBe(false);
  });

  it('帳本沒有的 trackKey 回 404；缺參數或多餘參數回 400', async () => {
    const { client } = await setup();
    expect((await client.agent.get('/api/taste/history').query({ trackKey: 'TEST nobody — nothing' })).status).toBe(404);
    expect((await client.agent.get('/api/taste/history')).status).toBe(400);
    expect((await client.agent.get('/api/taste/history').query({ trackKey: 'a — b', extra: '1' })).status).toBe(400);
  });
});
