import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { PROVIDER_NOTICES, ShowPlanSchema, countGraphemes } from '@qualia/contracts';
import { createApp } from '../src/app.js';
import { taipeiDay } from '../src/budget/ledger.js';
import { bootstrap, planRequest, postPlan, waitForJob } from './helpers.js';
import { MP3_BYTES, fakeOpenAI, realConfig } from './openaiHelpers.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const speechCalls = (fetchImpl: ReturnType<typeof fakeOpenAI>) => fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/audio/speech'));
const responseCalls = (fetchImpl: ReturnType<typeof fakeOpenAI>) => fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/responses'));
const readLedger = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as { totalUsd: number; days: Record<string, { usd: number; plans: number; graphemes: number }> };

async function runPlan(env: Record<string, string>, fetchImpl: ReturnType<typeof fakeOpenAI>) {
  const config = realConfig(env);
  const { app } = createApp(config, { fetchImpl });
  const client = await bootstrap(app);
  const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId, 10_000);
  const show = job.showId ? ShowPlanSchema.parse((await client.agent.get(`/api/shows/${job.showId}`).expect(200)).body) : null;
  return { job, show, config };
}

it('PLAN_DEADLINE 不足以合成全部 5 段：保留節目（completed），已合成段落用 AI 語音，其餘降級文字＋提示並明示；帳本只計實際打過的 TTS', async () => {
  // TTS 單次逾時 600ms：剩餘時間不足一次完整 TTS 逾時就不再開始下一段。
  const fetchImpl = fakeOpenAI({ speech: async () => { await sleep(500); return new Response(MP3_BYTES, { headers: { 'content-type': 'audio/mpeg' } }); } });
  const { job, show, config } = await runPlan({ PLAN_DEADLINE_MS: '1500', TTS_TIMEOUT_MS: '600' }, fetchImpl);

  expect(job.status).toBe('completed');
  expect(job.error).toBeNull();
  const segments = show!.segments;
  expect(segments).toHaveLength(5);
  const aiCount = segments.findIndex((s) => s.speech.kind !== 'ai_audio');
  expect(aiCount).toBeGreaterThan(0);
  expect(aiCount).toBeLessThan(5);
  // AI 段落是連續前綴，其餘全部是文字介紹＋提示音（mock_chime），不是 AI 語音。
  expect(segments.slice(0, aiCount).every((s) => s.speech.kind === 'ai_audio')).toBe(true);
  expect(segments.slice(aiCount).every((s) => s.speech.kind === 'mock_chime' && s.candidate.djLine.length > 0)).toBe(true);
  expect(show!.warnings.some((w) => w.startsWith(`${PROVIDER_NOTICES.tts}：`) && /時間/.test(w))).toBe(true);

  // 降級段落不打 TTS、不預扣：HTTP 次數與帳本都只反映已合成的段落。
  expect(speechCalls(fetchImpl)).toHaveLength(aiCount);
  expect(responseCalls(fetchImpl)).toHaveLength(1);
  const synthesized = segments.slice(0, aiCount).map((s) => s.candidate.djLine);
  const ledger = readLedger(config.openai.ledgerPath);
  const day = ledger.days[taipeiDay(Date.now())]!;
  expect(day.plans).toBe(1);
  expect(day.graphemes).toBe(synthesized.reduce((sum, line) => sum + countGraphemes(line), 0));
  const llmUsd = (100 * 1 + 100 * 2) / 1e6;
  const ttsUsd = synthesized.reduce((sum, line) => sum + [...line].length * 10 / 1e6, 0);
  expect(ledger.totalUsd).toBeCloseTo(llmUsd + ttsUsd, 9);
});

it('剩餘時間從一開始就不足一次 TTS 逾時：完全不打 TTS，節目仍完成並明示', async () => {
  const fetchImpl = fakeOpenAI();
  const { job, show, config } = await runPlan({ PLAN_DEADLINE_MS: '1000', TTS_TIMEOUT_MS: '5000' }, fetchImpl);
  expect(job.status).toBe('completed');
  expect(show!.segments.every((s) => s.speech.kind === 'mock_chime')).toBe(true);
  expect(show!.warnings.some((w) => w.startsWith(`${PROVIDER_NOTICES.tts}：`))).toBe(true);
  expect(speechCalls(fetchImpl)).toHaveLength(0);
  expect(readLedger(config.openai.ledgerPath).days[taipeiDay(Date.now())]!.graphemes).toBe(0);
});

it('deadline 在 LLM 階段到：照舊整輪 PLAN_TIMEOUT 失敗，不進 TTS', async () => {
  const fetchImpl = fakeOpenAI({ responses: () => new Promise<Response>(() => {}) });
  const { job } = await runPlan({ PLAN_DEADLINE_MS: '1000', PROVIDER_TIMEOUT_MS: '5000' }, fetchImpl);
  expect(job.status).toBe('failed');
  expect(job.error?.code).toBe('PLAN_TIMEOUT');
  expect(speechCalls(fetchImpl)).toHaveLength(0);
});

it('LLM 本身逾時（PROVIDER_TIMEOUT_MS）：照舊以 LLM 失敗處理（保留預扣、改用 MOCK 選歌並明示），不受 TTS 降級邏輯影響', async () => {
  const fetchImpl = fakeOpenAI({ responses: () => new Promise<Response>(() => {}) });
  const { job, show, config } = await runPlan({ PROVIDER_TIMEOUT_MS: '50', TTS_PROVIDER: 'mock' }, fetchImpl);
  expect(job.status).toBe('completed');
  expect(show!.warnings[0]).toMatch(new RegExp(`^${PROVIDER_NOTICES.llm}：.*逾時`));
  expect(responseCalls(fetchImpl)).toHaveLength(1);
  expect(readLedger(config.openai.ledgerPath).totalUsd).toBeGreaterThan(0);
});
