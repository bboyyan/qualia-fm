import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { BudgetLedger, sentinelPathFor } from '../src/budget/ledger.js';
import { RealProviderRuntime } from '../src/budget/runtime.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { OpenAITtsProvider } from '../src/providers/openai/tts.js';
import { bootstrap, planRequest, postPlan, waitForJob } from './helpers.js';
import { fakeOpenAI, realConfig, realEnv } from './openaiHelpers.js';

const limits = { dailyUsd: 1, totalUsd: 10, plansPerDay: 20, graphemesPerDay: 8000 };
const freshPath = () => join(mkdtempSync(join(tmpdir(), 'qualia-sentinel-')), 'ledger.json');

it('sentinel 命名為「帳本路徑＋.initialized」', () => {
  expect(sentinelPathFor('/srv/qualia/budget-ledger.json')).toBe('/srv/qualia/budget-ledger.json.initialized');
});

it('首次啟用（帳本與 sentinel 皆不存在）：建立零帳本並寫入 sentinel（權限 600），可正常預扣', () => {
  const path = freshPath();
  const ledger = new BudgetLedger(path, limits);
  expect(ledger.reason).toBeNull();
  expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ version: 1, totalUsd: 0 });
  const sentinel = sentinelPathFor(path);
  expect(existsSync(sentinel)).toBe(true);
  expect(statSync(sentinel).mode & 0o777).toBe(0o600);
  expect(() => ledger.reserve({ usd: 0.01 })).not.toThrow();
});

it('帳本遺失但 sentinel 存在：fail closed、不自動重建帳本、不能取得新額度', () => {
  const path = freshPath();
  new BudgetLedger(path, limits).reserve({ usd: 0.5 });
  unlinkSync(path);
  const restarted = new BudgetLedger(path, limits);
  expect(restarted.reason).toMatch(/帳本遺失/);
  expect(restarted.reason).toMatch(/人工/);
  expect(existsSync(path)).toBe(false);
  expect(() => restarted.reserve({ usd: 0.01 })).toThrow(/帳本/);
  expect(restarted.check()).toMatch(/帳本遺失/);
  expect(existsSync(path)).toBe(false);
});

it('帳本遺失但 sentinel 存在：重啟後 runtime 拒絕呼叫，capabilities 降級 mock 並標明原因，節目不發 HTTP', async () => {
  const env = realEnv({ MOCK_PHASE_MS: '0' });
  createApp(loadConfig(env), { fetchImpl: fakeOpenAI() });
  expect(existsSync(sentinelPathFor(env.BUDGET_LEDGER_PATH!))).toBe(true);
  unlinkSync(env.BUDGET_LEDGER_PATH!);

  const fetchImpl = fakeOpenAI();
  const config = loadConfig(env);
  const runtime = new RealProviderRuntime(config.openai);
  expect(runtime.reason()).toMatch(/帳本遺失/);
  await expect(new OpenAITtsProvider(config.openai, runtime, fetchImpl).synthesize('你好', new AbortController().signal)).rejects.toThrow(/帳本遺失/);

  const { app } = createApp(config, { fetchImpl });
  const client = await bootstrap(app);
  const caps = (await client.agent.get('/api/capabilities').expect(200)).body;
  expect(caps.providers).toMatchObject({ llm: 'mock', tts: 'mock' });
  expect(caps.providers.reason).toMatch(/帳本遺失/);
  const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  expect(job.status).toBe('completed');
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(existsSync(env.BUDGET_LEDGER_PATH!)).toBe(false);
});

it('舊版升級（帳本存在、sentinel 不存在）：驗證帳本合法後補寫 sentinel，保留原金額', () => {
  const path = freshPath();
  writeFileSync(path, JSON.stringify({ version: 1, halted: false, totalUsd: 0.25, days: { '2026-10-05': { usd: 0.25, plans: 2, graphemes: 40 } } }));
  const ledger = new BudgetLedger(path, limits);
  expect(ledger.reason).toBeNull();
  expect(ledger.snapshot().totalUsd).toBe(0.25);
  expect(statSync(sentinelPathFor(path)).mode & 0o777).toBe(0o600);
});

it('舊版升級但帳本不合法：不補寫 sentinel、fail closed', () => {
  const path = freshPath();
  writeFileSync(path, JSON.stringify({ version: 1, totalUsd: 0, days: { '2026-10-05': { usd: 1, plans: 1, graphemes: 1 } } }));
  const ledger = new BudgetLedger(path, limits);
  expect(ledger.reason).toContain('帳本');
  expect(existsSync(sentinelPathFor(path))).toBe(false);
});

it('BUDGET_LEDGER_PATH 為相對路徑且真實呼叫啟用：降級 mock 並標明原因，不建立任何帳本檔', async () => {
  const relative = `qualia-relative-ledger-${process.pid}-${Date.now()}`;
  try {
    const config = realConfig({ BUDGET_LEDGER_PATH: `${relative}/ledger.json` });
    expect(config.openai.reason).toMatch(/BUDGET_LEDGER_PATH/);
    expect(config.openai.reason).toMatch(/絕對路徑/);
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = createApp(config, { fetchImpl });
    const client = await bootstrap(app);
    const caps = (await client.agent.get('/api/capabilities').expect(200)).body;
    expect(caps.providers).toMatchObject({ llm: 'mock', tts: 'mock', reason: config.openai.reason });
    expect(existsSync(relative)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  } finally { rmSync(relative, { recursive: true, force: true }); }
});

it('相對路徑只在真實呼叫啟用時才拒絕：預設 mock 或未簽收時沿用原本的原因', () => {
  expect(loadConfig({ BUDGET_LEDGER_PATH: './data/budget-ledger.json' }).openai.reason).toBeNull();
  expect(realConfig({ BUDGET_LEDGER_PATH: './data/budget-ledger.json', OPENAI_REAL_CALLS_APPROVED: 'false' }).openai.reason).toMatch(/簽收/);
  // 預設值本身是相對路徑：真實呼叫啟用卻沒設絕對路徑時同樣降級。
  const { BUDGET_LEDGER_PATH: _ignored, ...withoutPath } = realEnv();
  expect(loadConfig(withoutPath).openai.reason).toMatch(/BUDGET_LEDGER_PATH/);
});

it('帳本類別本身也拒絕相對路徑（防禦）：不讀不寫、fail closed', () => {
  const relative = `qualia-relative-direct-${process.pid}-${Date.now()}.json`;
  try {
    const ledger = new BudgetLedger(relative, limits);
    expect(ledger.reason).toMatch(/絕對路徑/);
    expect(() => ledger.reserve({ usd: 0 })).toThrow(/絕對路徑/);
    expect(existsSync(relative)).toBe(false);
  } finally { rmSync(relative, { force: true }); }
});
