import { describe, expect, it } from 'vitest';
import { ShowPlanSchema, TasteMarksResponseSchema, trackKeyOf, type ShowPlan } from '@qualia/contracts';
import { InMemoryLedger } from '../src/ledger/fake.js';
import { TasteLedger, memoryPersistence, type TastePersistence } from '../src/ledger/tasteStore.js';
import { MockEditorialPlanner } from '../src/providers/mockPlanner.js';
import type { EditorialPlanner } from '../src/providers/types.js';
import type { EditorialInput } from '../src/services/editorialInput.js';
import { TASTE_AIRED_WARNING, TASTE_READ_WARNING } from '../src/services/tasteService.js';
import { ORIGIN, bootstrap, planRequest, postPlan, testApp, waitForJob, type Client } from './helpers.js';

/** 不標 kind 的 planner＝真實提名（會記播出紀錄）；內容沿用 MOCK 草稿。 */
function realStub(inputs: EditorialInput[] = []): EditorialPlanner {
  const mock = new MockEditorialPlanner();
  return { draft: async (input, context) => { inputs.push(input); return mock.draft(input, context); } };
}

/** 只留前 7 首：用來測「近 N 放回」警示（12 首池播 5 首後仍有 7 首新歌，不會觸發放回）。 */
function sevenStub(inputs: EditorialInput[] = []): EditorialPlanner {
  const inner = realStub(inputs);
  return {
    draft: async (input, context) => {
      const draft = await inner.draft(input, context) as { candidates: unknown[] };
      return { ...draft, candidates: draft.candidates.slice(0, 7) };
    },
  };
}

/** 可切換讀／寫失敗的記憶體後端。 */
function switchable() {
  const state = { body: null as string | null, failLoad: false, failSave: false };
  const persistence: TastePersistence = {
    load: () => { if (state.failLoad) throw new Error('TEST EIO'); return state.body; },
    save: (body) => { if (state.failSave) throw new Error('TEST ENOSPC'); state.body = body; },
  };
  return { state, ledger: new TasteLedger(persistence) };
}

const post = (client: Client, path: string, body: object) =>
  client.agent.post(path).set('Origin', ORIGIN).set('X-CSRF-Token', client.csrf).send(body);

async function newShow(client: Client): Promise<ShowPlan> {
  const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  return ShowPlanSchema.parse((await client.agent.get(`/api/shows/${job.showId}`).expect(200)).body);
}
const keyOfSegment = (show: ShowPlan, index: number): string => {
  const candidate = show.segments[index]!.candidate;
  return trackKeyOf(candidate.artist, candidate.title);
};

describe('BRA-98 回饋與品味帳本對齊', () => {
  it('聽完回饋同時寫品味帳本（LLM 提名的曲名／藝人＋評價＋短評）與 FeedbackLedger；重送只記一筆', async () => {
    const tasteLedger = new TasteLedger(memoryPersistence());
    const ledger = new InMemoryLedger();
    const client = await bootstrap(testApp({}, { ledger, tasteLedger }).app);
    const show = await newShow(client);
    const segment = show.segments[0]!;
    const body = { showId: show.showId, segmentId: segment.segmentId, rating: '不對', reason: 'TEST 太吵', clientRequestId: 'TEST-intent-1' };
    await post(client, '/api/feedback', body).expect(201);
    await post(client, '/api/feedback', body).expect(201);
    expect(await ledger.read()).toHaveLength(1);
    const marks = await tasteLedger.marks();
    expect(marks).toEqual([expect.objectContaining({ title: segment.candidate.title, artist: segment.candidate.artist, rating: '不對', note: 'TEST 太吵', mark: null })]);
  });

  it('品味帳本寫入失敗：回饋回錯誤（不靜默）、不寫 Notion 備份；恢復後重送成功', async () => {
    const { state, ledger: tasteLedger } = switchable();
    const ledger = new InMemoryLedger();
    const client = await bootstrap(testApp({}, { ledger, tasteLedger }).app);
    const show = await newShow(client);
    const body = { showId: show.showId, segmentId: show.segments[0]!.segmentId, rating: '愛', reason: '' };
    state.failSave = true;
    const failed = await post(client, '/api/feedback', body);
    expect(failed.status).toBe(500);
    expect(failed.body.error).toMatchObject({ code: 'INTERNAL', retryable: true, message: expect.stringContaining('品味帳本寫入失敗') });
    expect(await ledger.read()).toEqual([]);
    state.failSave = false;
    await post(client, '/api/feedback', body).expect(201);
    expect(await ledger.read()).toHaveLength(1);
    expect((await tasteLedger.marks())[0]?.rating).toBe('愛');
  });
});

describe('手動改評價／標記 API', () => {
  it('以節目段落標記 blocked → 清單可讀 → 下一輪開台硬排除', async () => {
    const client = await bootstrap(testApp({}, { planner: realStub(), tasteLedger: new TasteLedger(memoryPersistence()) }).app);
    const first = await newShow(client);
    const blockedKey = keyOfSegment(first, 0);
    const edited = await post(client, '/api/taste/marks', { target: { showId: first.showId, segmentId: first.segments[0]!.segmentId }, mark: 'blocked' }).expect(200);
    expect(edited.body).toMatchObject({ trackKey: blockedKey, mark: 'blocked' });
    const list = TasteMarksResponseSchema.parse((await client.agent.get('/api/taste/marks').expect(200)).body);
    expect(list.marks.find((m) => m.trackKey === blockedKey)?.mark).toBe('blocked');
    const second = await newShow(client);
    expect(second.segments.map((_, i) => keyOfSegment(second, i))).not.toContain(blockedKey);
    expect(second.unavailable.map((c) => trackKeyOf(c.artist, c.title))).not.toContain(blockedKey);
  });

  it('以 trackKey 手動改評價＋短評；planner 下一輪收到愛／不對與避開清單', async () => {
    const inputs: EditorialInput[] = [];
    const client = await bootstrap(testApp({}, { planner: realStub(inputs), tasteLedger: new TasteLedger(memoryPersistence()) }).app);
    const show = await newShow(client);
    const lovedKey = keyOfSegment(show, 1);
    await post(client, '/api/taste/marks', { target: { trackKey: lovedKey }, rating: '愛', note: 'TEST 想多聽這種低頻', clientRequestId: 'TEST-edit-1' }).expect(200);
    await post(client, '/api/taste/marks', { target: { showId: show.showId, segmentId: show.segments[2]!.segmentId }, rating: '不對', note: 'TEST 太亮' }).expect(200);
    await newShow(client);
    const hints = inputs[1]!.tasteHints;
    expect(hints.loved).toEqual([expect.objectContaining({ title: show.segments[1]!.candidate.title, note: 'TEST 想多聽這種低頻' })]);
    expect(hints.disliked).toEqual([expect.objectContaining({ title: show.segments[2]!.candidate.title, note: 'TEST 太亮' })]);
    expect(hints.avoid).toHaveLength(show.segments.length);
    expect(inputs[0]!.tasteHints).toEqual({ avoid: [], loved: [], disliked: [] });
  });

  it('pinned 標記後，下一輪節目第一首就是它', async () => {
    const client = await bootstrap(testApp({}, { planner: realStub(), tasteLedger: new TasteLedger(memoryPersistence()) }).app);
    const first = await newShow(client);
    const pinnedKey = keyOfSegment(first, 3);
    await post(client, '/api/taste/marks', { target: { trackKey: pinnedKey }, mark: 'pinned' }).expect(200);
    const second = await newShow(client);
    expect(keyOfSegment(second, 0)).toBe(pinnedKey);
  });

  it('輸入驗證：沒有 mark／rating 400、短評沒有評價 400、未知 trackKey 404、別人的節目 404', async () => {
    const app = testApp({}, { tasteLedger: new TasteLedger(memoryPersistence()) }).app;
    const client = await bootstrap(app);
    const show = await newShow(client);
    const target = { showId: show.showId, segmentId: show.segments[0]!.segmentId };
    expect((await post(client, '/api/taste/marks', { target })).status).toBe(400);
    expect((await post(client, '/api/taste/marks', { target, mark: 'blocked', note: 'TEST' })).status).toBe(400);
    expect((await post(client, '/api/taste/marks', { target, mark: 'TEST-invalid' })).status).toBe(400);
    expect((await post(client, '/api/taste/marks', { target: { trackKey: 'TEST nobody — nothing' }, mark: 'pinned' })).status).toBe(404);
    const other = await bootstrap(app);
    expect((await post(other, '/api/taste/marks', { target, mark: 'blocked' })).status).toBe(404);
    expect((await post(client, '/api/taste/marks', { target, mark: null })).status).toBe(200);
  });

  it('帳本讀不到時手動編輯與清單都回錯誤，不假裝成功', async () => {
    const broken = new TasteLedger({ load: () => { throw new Error('TEST EIO'); }, save: () => undefined });
    const client = await bootstrap(testApp({}, { tasteLedger: broken }).app);
    const res = await post(client, '/api/taste/marks', { target: { trackKey: 'TEST any' }, mark: 'blocked' });
    expect(res.status).toBe(500);
    expect(res.body.error.message).toContain('品味帳本');
    expect((await client.agent.get('/api/taste/marks')).status).toBe(500);
  });
});

describe('開台前必讀與播出紀錄', () => {
  it('真實提名排進節目即記為已播；下一輪避開近 N，不足時放回並明示', async () => {
    const tasteLedger = new TasteLedger(memoryPersistence());
    // 截成 7 首：前一輪播 5 首後只剩 2 首新歌，其餘 3 首放回並明示（12 首池不會觸發放回）。
    const client = await bootstrap(testApp({}, { planner: sevenStub(), tasteLedger }).app);
    const first = await newShow(client);
    expect((await tasteLedger.snapshot()).recentAired).toHaveLength(first.segments.length);
    const second = await newShow(client);
    const firstKeys = first.segments.map((_, i) => keyOfSegment(first, i));
    expect(firstKeys).not.toContain(keyOfSegment(second, 0));
    expect(firstKeys).not.toContain(keyOfSegment(second, 1));
    expect(second.warnings).toContain('近期已播的歌不夠避開：本輪重播 3 首最近 10 首內播過的歌。');
  });

  it('MOCK 草稿不記播出紀錄（示範模式不被近 N 擋光）', async () => {
    const tasteLedger = new TasteLedger(memoryPersistence());
    const client = await bootstrap(testApp({}, { tasteLedger }).app);
    await newShow(client);
    const second = await newShow(client);
    expect((await tasteLedger.snapshot()).recentAired).toEqual([]);
    expect(second.warnings.join(' ')).not.toContain('近期已播');
  });

  it('降級：帳本讀不到 → 照常開台、planner 不拿到品味提示、節目 warning 明示', async () => {
    const inputs: EditorialInput[] = [];
    const { state, ledger: tasteLedger } = switchable();
    state.failLoad = true;
    const client = await bootstrap(testApp({}, { planner: realStub(inputs), tasteLedger }).app);
    const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
    expect(job.status).toBe('completed');
    const show = (await client.agent.get(`/api/shows/${job.showId}`)).body as ShowPlan;
    expect(show.warnings).toContain(TASTE_READ_WARNING);
    expect(inputs[0]!.tasteHints).toEqual({ avoid: [], loved: [], disliked: [] });
  });

  it('降級：播出紀錄寫不進去 → 節目照常完成並明示可能重播', async () => {
    const { state, ledger: tasteLedger } = switchable();
    const client = await bootstrap(testApp({}, { planner: realStub(), tasteLedger }).app);
    await newShow(client);
    state.failSave = true;
    const show = await newShow(client);
    expect(show.segments).toHaveLength(5);
    expect(show.warnings).toContain(TASTE_AIRED_WARNING);
  });

  it('開台前先讀品味帳本，再呼叫 planner', async () => {
    const order: string[] = [];
    const tasteLedger = new TasteLedger({ load: () => { order.push('taste'); return null; }, save: () => undefined });
    const mock = new MockEditorialPlanner();
    const planner: EditorialPlanner = { draft: async (input, context) => { order.push('planner'); return mock.draft(input, context); } };
    const client = await bootstrap(testApp({}, { planner, tasteLedger }).app);
    await newShow(client);
    expect(order.slice(0, 2)).toEqual(['taste', 'planner']);
  });
});
