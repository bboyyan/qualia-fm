import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChooseGemResponseSchema, GEMS_PER_SELECTION, GemWallSchema, ShowPlanSchema, trackKeyOf, type ShowPlan } from '@qualia/contracts';
import { GemWallError, GemWallStore, type ChooseInput } from '../src/gems/gemWallStore.js';
import { filePersistence, memoryPersistence } from '../src/ledger/tasteStore.js';
import { ORIGIN, bootstrap, planRequest, postPlan, testApp, waitForJob, type Client } from './helpers.js';

const SEED = 'TEST 失戀第三天，想被陪著走一段';
const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qfm-gem-test-'));
  directories.push(dir);
  return dir;
}

function store(persistence = memoryPersistence()): GemWallStore {
  let clock = Date.parse('2026-10-06T00:00:00.000Z');
  let ids = 0;
  return new GemWallStore(persistence, () => (clock += 1000), () => `gem_test_${(ids += 1).toString().padStart(4, '0')}`);
}

const pick = (journey: number, track: number, palette = 0): ChooseInput => ({
  journeyId: `ss_test_${journey}`,
  title: `曲 ${track}`,
  artist: `藝人 ${track}`,
  trackKey: trackKeyOf(`藝人 ${track}`, `曲 ${track}`),
  palette,
});

describe('BRA-169 V2：寶石牆規則（GemWallStore）', () => {
  it('選後寫入寶石：只存曲名／藝人／色號／時間，牆上進行中這本多一顆', () => {
    const wall = store();
    const outcome = wall.choose(pick(1, 1, 3));
    expect(outcome.created).toBe(true);
    expect(outcome.gem).toEqual({
      gemId: 'gem_test_0001', journeyId: 'ss_test_1', trackKey: trackKeyOf('藝人 1', '曲 1'),
      title: '曲 1', artist: '藝人 1', palette: 3, chosenAt: '2026-10-06T00:00:01.000Z',
    });
    expect(wall.wall()).toEqual({ total: 1, selections: [], current: { no: 1, gems: [outcome.gem] } });
    expect(outcome.unlocked).toBeNull();
  });

  it('同一趟不重複：同一首重送是冪等（不新增），換一首回 409 GEM_ALREADY_CHOSEN', () => {
    const wall = store();
    const first = wall.choose(pick(1, 1));
    const again = wall.choose(pick(1, 1));
    expect(again.created).toBe(false);
    expect(again.gem).toEqual(first.gem);
    expect(() => wall.choose(pick(1, 2))).toThrow(expect.objectContaining({ code: 'GEM_ALREADY_CHOSEN', status: 409 }));
    expect(wall.wall().total).toBe(1);
  });

  it('跨旅程可重複：同一首歌在不同趟各成一顆寶石', () => {
    const wall = store();
    wall.choose(pick(1, 7));
    const second = wall.choose(pick(2, 7));
    expect(second.created).toBe(true);
    expect(wall.wall().current.gems.map((gem) => [gem.journeyId, gem.title])).toEqual([['ss_test_1', '曲 7'], ['ss_test_2', '曲 7']]);
  });

  it(`滿 ${GEMS_PER_SELECTION} 顆解鎖旅程精選集 No.1，下一本從 0/5 開始`, () => {
    const wall = store();
    for (let n = 1; n < GEMS_PER_SELECTION; n += 1) expect(wall.choose(pick(n, n)).unlocked).toBeNull();
    const fifth = wall.choose(pick(5, 5));
    expect(fifth.unlocked?.no).toBe(1);
    expect(fifth.unlocked?.gems.map((gem) => gem.title)).toEqual(['曲 1', '曲 2', '曲 3', '曲 4', '曲 5']);
    expect(fifth.wall.selections).toHaveLength(1);
    expect(fifth.wall.current).toEqual({ no: 2, gems: [] });
    // 第 6 顆進第 2 本，不重複解鎖第 1 本。
    expect(wall.choose(pick(6, 6)).unlocked).toBeNull();
    expect(GemWallSchema.parse(wall.wall()).current.gems).toHaveLength(1);
  });

  it('同趟冪等重送第 5 顆不會再回報解鎖', () => {
    const wall = store();
    for (let n = 1; n <= GEMS_PER_SELECTION; n += 1) wall.choose(pick(n, n));
    expect(wall.choose(pick(5, 5)).unlocked).toBeNull();
  });

  it('損毀檔：丟 GemWallError 且不覆寫原檔', () => {
    const path = join(tempDir(), 'gems.json');
    writeFileSync(path, '{"version":1,"gems":[{"oops":');
    const wall = store(filePersistence(path));
    expect(() => wall.wall()).toThrow(GemWallError);
    expect(() => wall.choose(pick(1, 1))).toThrow(GemWallError);
    expect(readFileSync(path, 'utf8')).toBe('{"version":1,"gems":[{"oops":');
  });
});

async function playedShow(client: Client): Promise<ShowPlan> {
  const job = await waitForJob(client, (await postPlan(client, planRequest({ seed: { kind: 'feeling', text: SEED, artist: null } }))).body.jobId);
  return ShowPlanSchema.parse((await client.agent.get(`/api/shows/${job.showId}`).expect(200)).body);
}

const choose = (client: Client, body: object) => client.agent.post('/api/gems').set('Origin', ORIGIN).set('X-CSRF-Token', client.csrf).send(body);

describe('BRA-169 /api/gems', () => {
  it('選自己節目的一首：201，曲名由伺服器查；GET 讀回同一面牆', async () => {
    const { app } = testApp();
    const client = await bootstrap(app);
    const show = await playedShow(client);
    const segment = show.segments[2]!;
    const res = await choose(client, { journeyId: 'ss_api_1', showId: show.showId, segmentId: segment.segmentId, palette: 2 }).expect(201);
    const body = ChooseGemResponseSchema.parse(res.body);
    expect(body.gem).toMatchObject({ title: segment.candidate.title, artist: segment.candidate.artist, palette: 2, journeyId: 'ss_api_1' });
    expect(GemWallSchema.parse((await client.agent.get('/api/gems').expect(200)).body).current.gems).toEqual([body.gem]);
    // 冪等重送 200；同趟換首 409。
    await choose(client, { journeyId: 'ss_api_1', showId: show.showId, segmentId: segment.segmentId, palette: 2 }).expect(200);
    const other = await choose(client, { journeyId: 'ss_api_1', showId: show.showId, segmentId: show.segments[0]!.segmentId, palette: 2 }).expect(409);
    expect(other.body.error.code).toBe('GEM_ALREADY_CHOSEN');
  });

  it('別人的節目 404、壞輸入 400、沒有 CSRF 403', async () => {
    const { app } = testApp();
    const owner = await bootstrap(app);
    const show = await playedShow(owner);
    const stranger = await bootstrap(app);
    const body = { journeyId: 'ss_api_2', showId: show.showId, segmentId: show.segments[0]!.segmentId, palette: 0 };
    await choose(stranger, body).expect(404);
    await choose(owner, { ...body, palette: 8 }).expect(400);
    await choose(owner, { ...body, title: '自填曲名' }).expect(400);
    await owner.agent.post('/api/gems').set('Origin', ORIGIN).send(body).expect(403);
  });
});

describe('BRA-169 V3：重啟服務後寶石牆仍在，資料檔不含種子原文', () => {
  it('寫入 GEM_WALL_PATH → 全新 app（新 SessionStore／JobStore）讀回同一面牆；檔案 600、無種子', async () => {
    const dir = tempDir();
    const env = { GEM_WALL_PATH: join(dir, 'gem-wall.json'), SESSION_STORE_PATH: join(dir, 'sessions.json'), TASTE_LEDGER_PATH: join(dir, 'taste.json') };
    const first = await bootstrap(testApp(env).app);
    const show = await playedShow(first);
    const chosen = ChooseGemResponseSchema.parse((await choose(first, { journeyId: 'ss_restart_1', showId: show.showId, segmentId: show.segments[1]!.segmentId, palette: 5 }).expect(201)).body);

    const restarted = await bootstrap(testApp(env).app); // 新程序：新 session、新 JobStore，只靠磁碟。
    const wall = GemWallSchema.parse((await restarted.agent.get('/api/gems').expect(200)).body);
    expect(wall.current.gems).toEqual([chosen.gem]);

    const raw = readFileSync(env.GEM_WALL_PATH, 'utf8');
    expect(raw).not.toContain(SEED);
    expect(raw).not.toContain('失戀');
    expect(raw).not.toContain(show.showId);
    expect(Object.keys(JSON.parse(raw).gems[0]).sort()).toEqual(['artist', 'chosenAt', 'gemId', 'journeyId', 'palette', 'title', 'trackKey']);
    expect(statSync(env.GEM_WALL_PATH).mode & 0o777).toBe(0o600);
  });

  it('沒設定路徑的測試環境只用記憶體：重啟後是空牆', async () => {
    const first = await bootstrap(testApp().app);
    const show = await playedShow(first);
    await choose(first, { journeyId: 'ss_mem_1', showId: show.showId, segmentId: show.segments[0]!.segmentId, palette: 0 }).expect(201);
    const fresh = await bootstrap(testApp().app);
    expect((await fresh.agent.get('/api/gems').expect(200)).body).toEqual({ total: 0, selections: [], current: { no: 1, gems: [] } });
  });
});

describe('寶石牆讀寫失敗', () => {
  it('損毀檔：GET 回 500 中文訊息，原檔不被覆寫', async () => {
    const path = join(tempDir(), 'gem-wall.json');
    writeFileSync(path, 'not json');
    const client = await bootstrap(testApp({ GEM_WALL_PATH: path }).app);
    const res = await client.agent.get('/api/gems').expect(500);
    expect(res.body.error.message).toContain('寶石牆');
    expect(readFileSync(path, 'utf8')).toBe('not json');
  });
});
