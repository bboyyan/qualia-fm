import { describe, expect, it } from 'vitest';
import { PlanDraftSchema, ShowPlanSchema, type Candidate, type ResolvedTrack, type ShowPlan } from '@qualia/contracts';
import { loadConfig } from '../src/config/env.js';
import { MockEditorialPlanner } from '../src/providers/mockPlanner.js';
import { OpenAIEditorialPlanner, candidateLimitFor } from '../src/providers/openai/planner.js';
import { PLAN_JSON_SCHEMA } from '../src/providers/openai/resources.js';
import type { CatalogResolver } from '../src/providers/types.js';
import type { EditorialInput } from '../src/services/editorialInput.js';
import { bootstrap, planRequest, postPlan, testApp, waitForJob, type Client } from './helpers.js';
import { realConfig } from './openaiHelpers.js';
import { nominatingPlanner } from './spotifyHelpers.js';

const NAMES = Array.from({ length: 12 }, (_, i) => ({ title: `TEST Song ${i + 1}`, artist: `TEST Artist ${i + 1}` }));
const songs = (...ns: number[]): string[] => ns.map((n) => `TEST Song ${n}`);

/** 假 resolver：指定曲名不可播，其餘可播；記錄試過哪些。 */
function resolverWith(unplayable: ReadonlySet<string> = new Set()) {
  const tried: string[] = [];
  const resolver: CatalogResolver = {
    resolve: async (candidate: Candidate): Promise<ResolvedTrack> => {
      tried.push(candidate.title);
      const ok = !unplayable.has(candidate.title);
      return {
        provider: 'mock', providerTrackId: null, canonicalTitle: candidate.title, canonicalArtists: [candidate.artist],
        artworkUrl: null, externalUrl: null, durationMs: ok ? 5000 : null,
        availability: ok ? 'resolved' : 'unavailable', canAttemptPlayback: ok,
        audioLocator: ok ? { kind: 'mock_tone', palette: 0, durationMs: 5000 } : { kind: 'none' },
      };
    },
  };
  return { resolver, tried };
}

async function plan(client: Client, text = 'TEST 深夜'): Promise<ShowPlan & { status: string }> {
  const job = await waitForJob(client, (await postPlan(client, planRequest({ seed: { kind: 'feeling', text, artist: null } }))).body.jobId);
  const show = ShowPlanSchema.parse((await client.agent.get(`/api/shows/${job.showId}`).expect(200)).body);
  return { ...show, status: job.status };
}
const titles = (show: ShowPlan): string[] => show.segments.map((s) => s.candidate.title);

/** 可重現的亂數（mulberry32）。 */
function seeded(start: number): () => number {
  let state = start >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('開台候選 8–12 首、目標可播仍 5 首（BRA-127）', () => {
  const input: EditorialInput = { history: [], seedKind: 'feeling', seedText: 'TEST', seedArtist: null, tuning: null, djEnabled: true, djLength: 'short', recentPicks: [], exploration: 0 };
  const draft = (tuning: string | null) => new MockEditorialPlanner().draft({ ...input, tuning }, { signal: new AbortController().signal, scenario: 'five', attempt: 1 });

  it('MOCK 候選池：開台 12 首、微調 8 首，都通過草稿 schema', async () => {
    expect(PlanDraftSchema.parse(await draft(null)).candidates).toHaveLength(12);
    expect(PlanDraftSchema.parse(await draft('TEST 再暖一點')).candidates).toHaveLength(8);
  });

  it('草稿 schema 接受 12 首、拒絕 13 首；送給模型的 JSON schema 上限同為 12', async () => {
    const base = PlanDraftSchema.parse(await draft(null));
    const thirteen = [...base.candidates, { ...base.candidates[0]!, candidateId: 'c13' }];
    expect(PlanDraftSchema.safeParse({ ...base, candidates: thirteen }).success).toBe(false);
    expect(PLAN_JSON_SCHEMA.properties.candidates.maxItems).toBe(12);
  });

  it('向模型要的候選數隨輸出 token 上限落在 8–12', () => {
    expect([candidateLimitFor(256), candidateLimitFor(4096), candidateLimitFor(5000), candidateLimitFor(16384)]).toEqual([8, 8, 9, 12]);
  });

  it.each([
    [4200, [8, 8, 8]],
    [4650, [8, 9, 9]],
    [5100, [9, 10, 10]],
    [5550, [10, 11, 11]],
    [6000, [11, 12, 12]],
  ])('token 門檻 %i 的前一個、當下、後一個 token', (threshold, expected) => {
    expect([threshold - 1, threshold, threshold + 1].map(candidateLimitFor)).toEqual(expected);
  });

  it('LLM 請求帶候選池上下限、同種子近期已選與探索度', () => {
    const recentPicks = [{ title: 'TEST Song 1', artist: 'TEST Artist 1' }];
    const body = OpenAIEditorialPlanner.requestBody(realConfig({ OPENAI_MAX_OUTPUT_TOKENS: '8192' }).openai, { ...input, recentPicks, exploration: 0.65 });
    const user = JSON.parse(body.input[1]!.content) as Record<string, unknown> & { editorialInput: EditorialInput };
    expect(user).toMatchObject({ candidateLimit: 12, candidateMin: 8, requestedCount: 5 });
    expect(user.editorialInput).toMatchObject({ recentPicks, exploration: 0.65 });
  });

  it('預設設定：最多試 12 首、探索度 0.5、記住 3 輪；超過 12 拒絕啟動', () => {
    expect(loadConfig({}).limits).toMatchObject({ maxCandidatesPerPlan: 12, planExploration: 0.5, recentSeedRuns: 3 });
    expect(() => loadConfig({ MAX_CANDIDATES_PER_PLAN: '13' })).toThrow();
  });
});

describe('不可播則補抽（BRA-127）', () => {
  it('前三首不可播 → 往下補抽到第 8 首湊滿 5 首，然後停手；節目照模型原順序', async () => {
    const { resolver, tried } = resolverWith(new Set(songs(1, 2, 3)));
    const client = await bootstrap(testApp({}, { planner: nominatingPlanner(NAMES), resolver }).app);
    const show = await plan(client);
    expect([show.status, titles(show)]).toEqual(['completed', songs(4, 5, 6, 7, 8)]);
    expect(show.unavailable.map((c) => c.title)).toEqual(songs(1, 2, 3));
    expect(tried).toEqual(songs(1, 2, 3, 4, 5, 6, 7, 8));
  });

  it('補抽最多試 MAX_CANDIDATES_PER_PLAN 首；仍不足 5 首就如實回 partial', async () => {
    const { resolver, tried } = resolverWith(new Set(songs(1, 2, 3)));
    const client = await bootstrap(testApp({ MAX_CANDIDATES_PER_PLAN: '6' }, { planner: nominatingPlanner(NAMES), resolver }).app);
    const show = await plan(client);
    expect([show.status, titles(show), tried.length]).toEqual(['partial', songs(4, 5, 6), 6]);
  });

  it('抽樣後補抽：不可播的換掉，最後 5 首都可播且依模型原順序排列', async () => {
    const unplayable = new Set(songs(2, 5, 9));
    const { resolver } = resolverWith(unplayable);
    const env = { PLAN_EXPLORATION_PCT: '100', PLAN_RECENT_RUNS: '0' };
    const client = await bootstrap(testApp(env, { planner: nominatingPlanner(NAMES), resolver, random: seeded(11) }).app);
    for (let round = 0; round < 8; round += 1) {
      const picked = titles(await plan(client));
      expect(picked).toHaveLength(5);
      expect(picked.some((title) => unplayable.has(title))).toBe(false);
      const order = picked.map((title) => Number(title.split(' ').at(-1)));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
  });
});

describe('候選池加大後抽樣（BRA-127）', () => {
  it('探索度 0：每輪都取模型前 5 首（不抽樣）', async () => {
    const client = await bootstrap(testApp({ PLAN_RECENT_RUNS: '0' }, { planner: nominatingPlanner(NAMES), resolver: resolverWith().resolver }).app);
    expect(titles(await plan(client))).toEqual(songs(1, 2, 3, 4, 5));
    expect(titles(await plan(client))).toEqual(songs(1, 2, 3, 4, 5));
  });

  it('探索度 > 0：多輪下來會抽到模型前 5 首以外的歌', async () => {
    const env = { PLAN_EXPLORATION_PCT: '50', PLAN_RECENT_RUNS: '0' };
    const client = await bootstrap(testApp(env, { planner: nominatingPlanner(NAMES), resolver: resolverWith().resolver, random: seeded(5) }).app);
    const seen = new Set<string>();
    for (let round = 0; round < 10; round += 1) for (const title of titles(await plan(client))) seen.add(title);
    expect(seen.size).toBeGreaterThan(5);
  });
});

describe('同種子排除近 N 次已選（BRA-127）', () => {
  it('同種子連開三輪：第二輪全換新；第三輪新曲不夠才把最早那輪的拿回來補', async () => {
    const seen: EditorialInput[] = [];
    const client = await bootstrap(testApp({}, { planner: nominatingPlanner(NAMES, seen), resolver: resolverWith().resolver }).app);
    expect(titles(await plan(client))).toEqual(songs(1, 2, 3, 4, 5));
    expect(titles(await plan(client))).toEqual(songs(6, 7, 8, 9, 10));
    expect(titles(await plan(client))).toEqual(songs(1, 2, 3, 11, 12));
    expect(seen[1]!.recentPicks.map((t) => t.title)).toEqual(songs(1, 2, 3, 4, 5));
    expect(seen.map((input) => input.exploration)).toEqual([0, 0, 0]);
  });

  it('同種子每重開一輪，送給模型的探索度就提高', async () => {
    const seen: EditorialInput[] = [];
    const client = await bootstrap(testApp({ PLAN_EXPLORATION_PCT: '50' }, { planner: nominatingPlanner(NAMES, seen), resolver: resolverWith().resolver, random: seeded(2) }).app);
    for (let round = 0; round < 3; round += 1) await plan(client);
    expect(seen.map((input) => input.exploration)).toEqual([0.5, 0.65, 0.8]);
  });

  it('不同種子不互相排除', async () => {
    const client = await bootstrap(testApp({}, { planner: nominatingPlanner(NAMES), resolver: resolverWith().resolver }).app);
    await plan(client, 'TEST 深夜');
    expect(titles(await plan(client, 'TEST 清晨'))).toEqual(songs(1, 2, 3, 4, 5));
  });

  it('不同 session 不共用排除紀錄', async () => {
    const app = testApp({}, { planner: nominatingPlanner(NAMES), resolver: resolverWith().resolver }).app;
    await plan(await bootstrap(app));
    expect(titles(await plan(await bootstrap(app)))).toEqual(songs(1, 2, 3, 4, 5));
  });

  it('PLAN_RECENT_RUNS=0 時不排除', async () => {
    const client = await bootstrap(testApp({ PLAN_RECENT_RUNS: '0' }, { planner: nominatingPlanner(NAMES), resolver: resolverWith().resolver }).app);
    await plan(client);
    expect(titles(await plan(client))).toEqual(songs(1, 2, 3, 4, 5));
  });

  it('MOCK 虛構曲目維持固定順序，不抽樣也不排除（E2E 可重現）', async () => {
    const client = await bootstrap(testApp({ PLAN_EXPLORATION_PCT: '100' }).app);
    const first = titles(await plan(client));
    expect(titles(await plan(client))).toEqual(first);
    expect(first[0]).toBe('微光偏航');
  });
});
