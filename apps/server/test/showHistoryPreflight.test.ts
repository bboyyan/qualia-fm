import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { RealProviderRuntime } from '../src/budget/runtime.js';
import { InMemoryLedger } from '../src/ledger/fake.js';
import { ShowHistory } from '../src/ledger/showHistory.js';
import { TasteLedger, filePersistence, memoryPersistence } from '../src/ledger/tasteStore.js';
import { MockCatalogResolver } from '../src/providers/mockCatalog.js';
import { OpenAITtsProvider } from '../src/providers/openai/tts.js';
import { SessionStore } from '../src/security/sessions.js';
import { PlanService } from '../src/services/planService.js';
import { TasteService } from '../src/services/tasteService.js';
import { JobStore } from '../src/stores/jobStore.js';
import { RecentPicks } from '../src/stores/recentPicks.js';
import { newKey, planRequest, testConfig } from './helpers.js';
import { nominatingPlanner } from './spotifyHelpers.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'qfm-history-preflight-'));
  dirs.push(dir);
  const path = join(dir, 'history.json');
  const config = testConfig({ MOCK_PHASE_MS: '0' });
  const runtime = new RealProviderRuntime(config.openai);
  let plans = 0;
  const claim = vi.spyOn(runtime, 'claimPlan').mockImplementation(async () => { plans += 1; });
  const tts = new OpenAITtsProvider(config.openai, runtime, async () => { throw new Error('禁止網路'); });
  const speech = vi.spyOn(tts, 'synthesize').mockResolvedValue({ kind: 'ai_audio', aiVoice: true, url: '/api/media/tts/TEST-audio' });
  const planner = nominatingPlanner(Array.from({ length: 5 }, (_, i) => ({ title: `TEST Song ${i}`, artist: 'TEST Artist' })));
  const llm = vi.spyOn(planner, 'draft');
  const tasteLedger = new TasteLedger(memoryPersistence());
  const tasteService = new TasteService(tasteLedger, Date.now);
  const aired = vi.spyOn(tasteService, 'recordAired');
  const sessionPersistence = memoryPersistence();
  const sessions = new SessionStore(sessionPersistence);
  const remember = vi.spyOn(sessions, 'rememberShow');
  const recent = new RecentPicks(3);
  const recordRecent = vi.spyOn(recent, 'record');
  const showHistory = new ShowHistory(filePersistence(path));
  const service = new PlanService({
    config, runtime, tts, planner, tasteService, sessions, showHistory, recentPicks: recent,
    store: new JobStore(), ledger: new InMemoryLedger(), resolver: new MockCatalogResolver(5000),
    now: Date.now, clock: { wait: async () => {} },
  });
  const run = async () => {
    const job = service.start({ ownerId: 'owner', request: planRequest(), idempotencyKey: newKey(), scenario: 'five' });
    await vi.waitFor(() => expect(service.get('owner', job.jobId).status).not.toMatch(/^(queued|running)$/));
    return service.get('owner', job.jobId);
  };
  return { path, run, claim, plans: () => plans, speech, llm, tasteLedger, aired, remember, sessionPersistence, recent, recordRecent, showHistory };
}

it('歷史損毀時開台零外呼、零扣額度、零副作用；人工修復後同一服務可開台', async () => {
  const h = harness();
  writeFileSync(h.path, 'broken');
  const before = await h.tasteLedger.snapshot();
  const job = await h.run();
  expect.soft(h.llm).not.toHaveBeenCalled();
  expect.soft(h.speech).not.toHaveBeenCalled();
  expect.soft(h.claim).not.toHaveBeenCalled();
  expect.soft(h.plans()).toBe(0);
  expect.soft(h.aired).not.toHaveBeenCalled();
  expect.soft(await h.tasteLedger.snapshot()).toEqual(before);
  expect.soft(h.remember).not.toHaveBeenCalled();
  expect.soft(h.sessionPersistence.load()).toBeNull();
  expect.soft(h.recordRecent).not.toHaveBeenCalled();
  expect.soft(h.recent.recent('owner', planRequest().seed).runs).toBe(0);
  expect.soft(job).toMatchObject({ status: 'failed', showId: null, error: { code: 'HISTORY_UNAVAILABLE', retryable: false, message: '開台歷史檔讀不到或已損毀，需要人工修復後才能開台；本次未扣額度。' } });
  expect(readFileSync(h.path, 'utf8')).toBe('broken');
  writeFileSync(h.path, JSON.stringify({ version: 1, shows: [] }));
  expect((await h.run()).status).toBe('completed');
  expect(h.plans()).toBe(1);
  expect(h.llm).toHaveBeenCalledTimes(1);
  expect(h.speech).toHaveBeenCalledTimes(5);
  expect(h.showHistory.list()).toHaveLength(1);
});

it('歷史檔不存在視為空歷史，仍可正常開台及建立摘要', async () => {
  const h = harness();
  expect((await h.run()).status).toBe('completed');
  expect(h.plans()).toBe(1);
  expect(h.llm).toHaveBeenCalledTimes(1);
  expect(h.speech).toHaveBeenCalledTimes(5);
  expect(h.showHistory.list()).toHaveLength(1);
});

it('歷史無法讀取時也在任何外呼及扣額度前停止', async () => {
  const h = harness();
  // 目錄無法當 JSON 檔讀取，不依賴執行者是否能繞過 chmod 權限。
  mkdirSync(h.path);
  expect(await h.run()).toMatchObject({ status: 'failed', error: { code: 'HISTORY_UNAVAILABLE', retryable: false } });
  expect(h.claim).not.toHaveBeenCalled();
  expect(h.llm).not.toHaveBeenCalled();
  expect(h.speech).not.toHaveBeenCalled();
  expect(h.aired).not.toHaveBeenCalled();
  expect(h.remember).not.toHaveBeenCalled();
  expect(h.recordRecent).not.toHaveBeenCalled();
});
