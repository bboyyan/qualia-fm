import { setImmediate } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import type { Seed } from '@qualia/contracts';
import { RealProviderRuntime } from '../src/budget/runtime.js';
import { InMemoryLedger } from '../src/ledger/fake.js';
import { MockCatalogResolver } from '../src/providers/mockCatalog.js';
import { OpenAITtsProvider, type AiSpeech } from '../src/providers/openai/tts.js';
import type { EditorialInput } from '../src/services/editorialInput.js';
import { PlanService } from '../src/services/planService.js';
import { JobStore } from '../src/stores/jobStore.js';
import { RecentPicks } from '../src/stores/recentPicks.js';
import { TasteLedger, memoryPersistence } from '../src/ledger/tasteStore.js';
import { TasteService } from '../src/services/tasteService.js';
import { newKey, planRequest, testConfig } from './helpers.js';
import { nominatingPlanner } from './spotifyHelpers.js';

const seed: Seed = { kind: 'song', text: 'TEST 同名曲', artist: 'TEST Artist A' };
const speech: AiSpeech = { kind: 'ai_audio', aiVoice: true, url: '/api/media/tts/TEST-audio' };
const names = Array.from({ length: 12 }, (_, i) => ({ title: `TEST Song ${i + 1}`, artist: `TEST Artist ${i + 1}` }));

function harness(count = 12) {
  const config = testConfig({ MOCK_PHASE_MS: '0', PLAN_EXPLORATION_PCT: '50' });
  const store = new JobStore();
  const recent = new RecentPicks(3);
  const record = vi.spyOn(recent, 'record');
  const seen: EditorialInput[] = [];
  // 僅替換 synthesize；不啟用真實供應商、不碰網路或計費。
  const tts = new OpenAITtsProvider(config.openai, new RealProviderRuntime(config.openai), async () => { throw new Error('禁止網路'); });
  const synthesize = vi.spyOn(tts, 'synthesize').mockResolvedValue(speech);
  const service = new PlanService({
    config, store, recentPicks: recent, ledger: new InMemoryLedger(),
    tasteService: new TasteService(new TasteLedger(memoryPersistence()), Date.now),
    planner: nominatingPlanner(names.slice(0, count), seen), resolver: new MockCatalogResolver(5000),
    tts, now: Date.now, clock: { wait: async () => {} }, random: () => 0.5,
  });
  const start = (requestSeed = seed, scenario: 'five' | 'zero' = 'five', key = newKey()) => service.start({
    ownerId: 'owner', request: planRequest({ seed: requestSeed }), idempotencyKey: key, scenario,
  });
  const done = async (jobId: string) => {
    await vi.waitFor(() => expect(service.get('owner', jobId).status).not.toMatch(/^(queued|running)$/));
    return service.get('owner', jobId);
  };
  return { service, store, recent, record, seen, synthesize, start, done };
}

function holdSpeech(h: ReturnType<typeof harness>, rejectOnAbort = true) {
  let enter!: () => void;
  let release!: () => void;
  let reject!: (reason: unknown) => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const pending = new Promise<AiSpeech>((resolve, rejectPromise) => {
    release = () => resolve(speech);
    reject = rejectPromise;
  });
  h.synthesize.mockImplementationOnce(async (_text, signal) => {
    if (rejectOnAbort) signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    enter();
    return pending;
  });
  return { entered, release };
}

const emptyRecent = { history: [], tracks: [], runs: 0 };

describe('D-23：只記錄已交付節目的選曲', () => {
  it.each(['cancel', 'timeout', 'late-cancel'] as const)('TTS 中 %s：無 show，下一輪近期選曲與探索度不變', async (mode) => {
    const h = harness();
    const gate = holdSpeech(h, mode !== 'late-cancel');
    const first = h.start();
    await gate.entered;
    if (mode === 'timeout') h.store.get(first.jobId, 'owner')!.controller.abort('timeout');
    else h.service.cancel('owner', first.jobId);
    gate.release();
    // 等候忽略 abort 的晚回覆也離開 pipeline，避免只驗證 cancel 的同步狀態。
    await setImmediate();
    const job = await h.done(first.jobId);
    expect(job.status).toBe(mode === 'timeout' ? 'failed' : 'cancelled');
    if (mode === 'timeout') expect(job.error?.code).toBe('PLAN_TIMEOUT');
    expect(job.showId).toBeNull();
    expect(h.store.ownedShows('owner')).toEqual([]);
    expect(h.record).not.toHaveBeenCalled();
    expect(h.recent.recent('owner', seed)).toEqual(emptyRecent);
    await h.done(h.start().jobId);
    expect(h.seen[1]).toMatchObject({ recentPicks: [], exploration: 0.5 });
  });

  it('TTS 成功但儲存節目失敗：不得記錄，下一輪不受污染', async () => {
    const h = harness();
    vi.spyOn(h.store, 'putShow').mockImplementationOnce(() => { throw new Error('TEST 儲存失敗'); });
    const first = await h.done(h.start().jobId);
    expect(first).toMatchObject({ status: 'failed', showId: null });
    expect(h.synthesize).toHaveBeenCalledTimes(5);
    expect(h.store.ownedShows('owner')).toEqual([]);
    expect(h.record).not.toHaveBeenCalled();
    await h.done(h.start().jobId);
    expect(h.seen[1]).toMatchObject({ recentPicks: [], exploration: 0.5 });
  });

  it.each([3, 5])('成功交付 %i 首才寫入一次，下一輪帶入已交付曲目並提高探索度', async (count) => {
    const h = harness(count);
    const gate = holdSpeech(h);
    const key = newKey();
    const first = h.start(seed, 'five', key);
    await gate.entered;
    try {
      expect(h.record).not.toHaveBeenCalled();
      expect(h.recent.recent('owner', seed)).toEqual(emptyRecent);
      expect(h.store.ownedShows('owner')).toEqual([]);
    } finally { gate.release(); }
    const job = await h.done(first.jobId);
    expect(job.status).toBe(count === 5 ? 'completed' : 'partial');
    const show = h.service.show('owner', job.showId!);
    expect(show.segments).toHaveLength(count);
    expect(show.segments.every((s) => s.speech.kind === 'ai_audio')).toBe(true);
    const picks = show.segments.map(({ candidate: { title, artist } }) => ({ title, artist }));
    expect(h.recent.recent('owner', seed)).toEqual({ history: [picks], tracks: picks, runs: 1 });
    expect(h.start(seed, 'five', key).jobId).toBe(first.jobId);
    expect(h.record).toHaveBeenCalledTimes(1);
    await h.done(h.start().jobId);
    expect(h.seen[1]).toMatchObject({ recentPicks: picks, exploration: 0.65 });
  });

  it('無可播曲目不記錄空輪次，也不提高下一輪探索度', async () => {
    const h = harness();
    const job = await h.done(h.start(seed, 'zero').jobId);
    expect(job.status).toBe('partial');
    expect(h.service.show('owner', job.showId!).segments).toEqual([]);
    expect(h.record).not.toHaveBeenCalled();
    await h.done(h.start().jobId);
    expect(h.seen[1]).toMatchObject({ recentPicks: [], exploration: 0.5 });
  });

  it('同曲名不同藝人的種子不共用近期選曲或探索度', async () => {
    const h = harness();
    await h.done(h.start().jobId);
    const original = h.recent.recent('owner', seed);
    const other: Seed = { ...seed, artist: 'TEST Artist B' };
    expect(h.recent.recent('owner', other)).toEqual(emptyRecent);
    await h.done(h.start(other).jobId);
    expect(h.seen[1]).toMatchObject({ recentPicks: [], exploration: 0.5, seedArtist: other.artist });
    expect(h.recent.recent('owner', seed)).toEqual(original);
    await h.done(h.start().jobId);
    expect(h.seen[2]).toMatchObject({ recentPicks: original.tracks, exploration: 0.65 });
  });
});
