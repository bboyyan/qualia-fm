import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { PROVIDER_NOTICES, ShowPlanSchema, countGraphemes } from '@qualia/contracts';
import { createApp } from '../src/app.js';
import { logger } from '../src/http/log.js';
import { BudgetLedger } from '../src/budget/ledger.js';
import { bootstrap, planRequest, postPlan, waitForJob } from './helpers.js';
import { MP3_BYTES, fakeOpenAI, realConfig, responsesBody, validDraftText } from './openaiHelpers.js';

afterEach(() => vi.restoreAllMocks());
const speechCalls = (fetchImpl: ReturnType<typeof fakeOpenAI>) => fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/audio/speech'));
const responseCalls = (fetchImpl: ReturnType<typeof fakeOpenAI>) => fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/responses'));
const readLedger = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as { totalUsd: number; days: Record<string, { usd: number; plans: number; graphemes: number }> };

function expectTtsLedger(config: ReturnType<typeof realConfig>, show: ReturnType<typeof ShowPlanSchema.parse>, attemptedSegments: number, retries = 0) {
  // 成功與失敗的已送出段落都計費；尚未嘗試的降級段落不得預扣。
  const lines = show.segments.slice(0, attemptedSegments).map((segment) => segment.candidate.djLine);
  if (retries) lines.push(...Array<string>(retries).fill(lines.at(-1)!));
  const ttsUsd = lines.reduce((sum, line) => sum + [...line].length * 10 / 1e6, 0);
  const llmUsd = (100 * 1 + 100 * 2) / 1e6; // fakeOpenAI 的成功 LLM usage。
  const ledger = readLedger(config.openai.ledgerPath);
  const days = Object.values(ledger.days);
  expect(days.reduce((sum, day) => sum + day.plans, 0)).toBe(1);
  expect(days.reduce((sum, day) => sum + day.graphemes, 0)).toBe(lines.reduce((sum, line) => sum + countGraphemes(line), 0));
  expect(days.reduce((sum, day) => sum + day.usd, 0)).toBeCloseTo(llmUsd + ttsUsd, 9);
  expect(ledger.totalUsd).toBeCloseTo(llmUsd + ttsUsd, 9);
  // 重新開啟實際持久化帳本，確認失敗預扣 retain 不會於重啟退回。
  const restarted = new BudgetLedger(config.openai.ledgerPath, config.openai.budget);
  expect(restarted.reason).toBeNull();
  expect(restarted.snapshot()).toEqual(ledger);
}

async function runPlan(env: Record<string, string>, fetchImpl: ReturnType<typeof fakeOpenAI>) {
  const config = realConfig(env);
  const { app } = createApp(config, { fetchImpl });
  const client = await bootstrap(app);
  const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId, 10_000);
  const show = job.showId ? ShowPlanSchema.parse((await client.agent.get(`/api/shows/${job.showId}`).expect(200)).body) : null;
  return { job, show, config };
}

it('PLAN_DEADLINE 不足以合成全部 5 段：保留節目（completed），已合成段落用 AI 語音，其餘降級文字＋提示並明示；帳本只計實際打過的 TTS', async () => {
  // 固定單調時鐘：每段耗時 250ms，第四段完成後已用完 TTS 時間。
  let elapsed = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
  const log = vi.spyOn(logger, 'info');
  const fetchImpl = fakeOpenAI({ speech: () => { elapsed += 250; return new Response(MP3_BYTES, { headers: { 'content-type': 'audio/mpeg' } }); } });
  const { job, show, config } = await runPlan({ PLAN_DEADLINE_MS: '1250', TTS_TIMEOUT_MS: '5000' }, fetchImpl);

  expect(job.status).toBe('completed');
  expect(job.error).toBeNull();
  const segments = show!.segments;
  expect(segments).toHaveLength(5);
  const aiCount = segments.findIndex((s) => s.speech.kind !== 'ai_audio');
  expect(aiCount).toBe(4);
  expect(log).toHaveBeenCalledWith('tts_degraded', expect.objectContaining({
    showId: show!.showId, remainingMs: 0, deadlineMs: 1250, ttsTimeoutMs: 5000,
    reason: 'TTS_DEADLINE_EXHAUSTED', synthesizedSegments: 4, degradedSegments: 1,
  }));
  // AI 段落是連續前綴，其餘全部是文字介紹＋提示音（mock_chime），不是 AI 語音。
  expect(segments.slice(0, aiCount).every((s) => s.speech.kind === 'ai_audio')).toBe(true);
  expect(segments.slice(aiCount).every((s) => s.speech.kind === 'mock_chime' && s.candidate.djLine.length > 0)).toBe(true);
  expect(show!.warnings.some((w) => w.startsWith(`${PROVIDER_NOTICES.tts}：`) && /時間/.test(w))).toBe(true);

  // 降級段落不打 TTS、不預扣：HTTP 次數與帳本都只反映已合成的段落。
  expect(speechCalls(fetchImpl)).toHaveLength(aiCount);
  expect(responseCalls(fetchImpl)).toHaveLength(1);
  expectTtsLedger(config, show!, aiCount);
});

it('選歌後剩餘不足完整 TTS timeout：仍合成全部段落，不整輪跳過', async () => {
  let elapsed = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
  const log = vi.spyOn(logger, 'info');
  const fetchImpl = fakeOpenAI({ speech: () => {
    elapsed += 50;
    return new Response(MP3_BYTES, { headers: { 'content-type': 'audio/mpeg' } });
  } });
  const { job, show, config } = await runPlan({ PLAN_DEADLINE_MS: '1000', TTS_TIMEOUT_MS: '5000' }, fetchImpl);
  expect(job.status).toBe('completed');
  expect(show!.segments.every((s) => s.speech.kind === 'ai_audio')).toBe(true);
  expect(show!.warnings.some((w) => w.startsWith(`${PROVIDER_NOTICES.tts}：`))).toBe(false);
  expect(speechCalls(fetchImpl)).toHaveLength(5);
  expect(log.mock.calls.some(([event]) => event === 'tts_degraded')).toBe(false);
  expectTtsLedger(config, show!, 5);
});

it('選歌已用完 TTS 時間：不打 TTS，保留收尾餘裕並記錄結構化降級', async () => {
  let elapsed = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
  const log = vi.spyOn(logger, 'info');
  const fetchImpl = fakeOpenAI({ responses: async () => {
    elapsed = 800;
    return Response.json(responsesBody(await validDraftText()));
  } });
  const { job, show, config } = await runPlan({ PLAN_DEADLINE_MS: '1000', TTS_TIMEOUT_MS: '5000' }, fetchImpl);
  expect(job.status).toBe('completed');
  expect(show!.segments.every((s) => s.speech.kind === 'mock_chime')).toBe(true);
  expect(show!.warnings.some((w) => w.startsWith(`${PROVIDER_NOTICES.tts}：`))).toBe(true);
  expect(speechCalls(fetchImpl)).toHaveLength(0);
  expectTtsLedger(config, show!, 0);
  expect(log).toHaveBeenCalledWith('tts_degraded', {
    showId: show!.showId, remainingMs: 0, deadlineMs: 1000, ttsTimeoutMs: 5000,
    reason: 'TTS_DEADLINE_EXHAUSTED', synthesizedSegments: 0, degradedSegments: 5,
  });
});

it('剩餘 deadline 內 TTS 未回覆：只降級語音，不讓整輪 PLAN_TIMEOUT', async () => {
  const log = vi.spyOn(logger, 'info');
  const fetchImpl = fakeOpenAI({ speech: () => new Promise<Response>(() => {}) });
  const { job, show, config } = await runPlan({ PLAN_DEADLINE_MS: '1000', TTS_TIMEOUT_MS: '5000' }, fetchImpl);
  expect(job.status).toBe('completed');
  expect(job.error).toBeNull();
  expect(show!.segments.every((s) => s.speech.kind === 'mock_chime')).toBe(true);
  expect(show!.warnings.some((w) => /時間不足/.test(w))).toBe(true);
  expect(speechCalls(fetchImpl)).toHaveLength(1);
  expectTtsLedger(config, show!, 1);
  expect(log).toHaveBeenCalledWith('tts_degraded', expect.objectContaining({
    deadlineMs: 1000, ttsTimeoutMs: 5000, reason: 'TTS_DEADLINE_TIMEOUT',
  }));
  const fields = log.mock.calls.find(([event]) => event === 'tts_degraded')![1]!;
  expect(fields.remainingMs).toBeGreaterThanOrEqual(0);
  expect(fields.remainingMs).toBeLessThan(20);
});

it('TTS 自身 timeout 與 deadline 降級使用不同 reason code', async () => {
  const log = vi.spyOn(logger, 'info');
  const fetchImpl = fakeOpenAI({ speech: () => new Promise<Response>(() => {}) });
  const { job, show, config } = await runPlan({ PLAN_DEADLINE_MS: '2000', TTS_TIMEOUT_MS: '50' }, fetchImpl);
  expect(job.status).toBe('completed');
  expect(show!.segments.every((s) => s.speech.kind === 'mock_chime')).toBe(true);
  expect(speechCalls(fetchImpl)).toHaveLength(1);
  expectTtsLedger(config, show!, 1);
  expect(log).toHaveBeenCalledWith('tts_degraded', expect.objectContaining({
    deadlineMs: 2000, ttsTimeoutMs: 50, reason: 'TTS_PROVIDER_TIMEOUT',
  }));
});

it.each([0, 1, 3])('成功 %i 段後供應商重試仍失敗：保留成功段落與失敗預扣，後續停止並記錄單次降級', async (succeeded) => {
  const log = vi.spyOn(logger, 'info');
  let calls = 0;
  const fetchImpl = fakeOpenAI({ speech: () => ++calls <= succeeded
    ? new Response(MP3_BYTES, { headers: { 'content-type': 'audio/mpeg' } })
    : new Response('PRIVATE provider details', { status: 503 }) });
  const { job, show, config } = await runPlan({ PLAN_DEADLINE_MS: '2000', TTS_TIMEOUT_MS: '1000' }, fetchImpl);
  expect(job.status).toBe('completed');
  expect(show!.segments.slice(0, succeeded).every((s) => s.speech.kind === 'ai_audio')).toBe(true);
  expect(show!.segments.slice(succeeded).every((s) => s.speech.kind === 'mock_chime')).toBe(true);
  expect(speechCalls(fetchImpl)).toHaveLength(succeeded + 2);
  expectTtsLedger(config, show!, succeeded + 1, 1);
  const degraded = log.mock.calls.filter(([event]) => event === 'tts_degraded');
  expect(degraded).toHaveLength(1);
  expect(degraded[0]![1]).toMatchObject({
    showId: show!.showId, deadlineMs: 2000, ttsTimeoutMs: 1000,
    reason: 'TTS_PROVIDER_FAILED', synthesizedSegments: succeeded, degradedSegments: 5 - succeeded,
    segmentId: show!.segments[succeeded]!.segmentId, providerCode: 'HTTP_503', providerStatus: 503, providerAttempts: 2, providerRetryable: true,
  });
  expect(JSON.stringify(degraded)).not.toContain('PRIVATE');
  expect(show!.warnings.join()).not.toContain('PRIVATE');
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


it('供應商瞬時失敗重試恢復：五段 AI 語音，沒有降級 warning／log', async () => {
  const log = vi.spyOn(logger, 'info');
  let calls = 0;
  const fetchImpl = fakeOpenAI({ speech: () => ++calls === 1
    ? new Response('PRIVATE', { status: 503 }) : new Response(MP3_BYTES) });
  const { job, show } = await runPlan({ PLAN_DEADLINE_MS: '2000', TTS_TIMEOUT_MS: '1000' }, fetchImpl);
  expect(job.status).toBe('completed');
  expect(show!.segments.every((s) => s.speech.kind === 'ai_audio')).toBe(true);
  expect(show!.warnings.some((w) => w.startsWith(PROVIDER_NOTICES.tts))).toBe(false);
  expect(log.mock.calls.some(([event]) => event === 'tts_degraded')).toBe(false);
  expect(speechCalls(fetchImpl)).toHaveLength(6);
});

it('重試等待中段落 deadline 先到：保留 TTS_DEADLINE_TIMEOUT，不發第二次 HTTP', async () => {
  const log = vi.spyOn(logger, 'info');
  const fetchImpl = fakeOpenAI({ speech: async () => {
    await new Promise((resolve) => setTimeout(resolve, 650));
    return new Response('PRIVATE', { status: 503 });
  } });
  const { job, show, config } = await runPlan({ PLAN_DEADLINE_MS: '1000', TTS_TIMEOUT_MS: '5000' }, fetchImpl);
  expect(job.status).toBe('completed');
  expect(show!.segments.every((s) => s.speech.kind === 'mock_chime')).toBe(true);
  expect(speechCalls(fetchImpl)).toHaveLength(1);
  expectTtsLedger(config, show!, 1);
  expect(log).toHaveBeenCalledWith('tts_degraded', expect.objectContaining({
    reason: 'TTS_DEADLINE_TIMEOUT', providerCode: 'TIMEOUT', providerAttempts: 1,
  }));
});
