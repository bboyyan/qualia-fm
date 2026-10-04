import { writeFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { PROVIDER_NOTICES } from '@qualia/contracts';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { bootstrap, planRequest, postPlan, waitForJob } from './helpers.js';
import { fakeOpenAI, realEnv } from './openaiHelpers.js';

type Case = { name: string; env?: Record<string, string>; before?: (env: Record<string, string>) => void; after?: (env: Record<string, string>) => void };
const CASES: Case[] = [
  { name: '未簽收', env: { OPENAI_REAL_CALLS_APPROVED: 'false' } },
  { name: '簽收值留空', env: { OPENAI_REAL_CALLS_APPROVED: '' } },
  { name: '缺金鑰', env: { OPENAI_API_KEY: '' } },
  { name: '缺文字模型', env: { OPENAI_TEXT_MODEL: '' } },
  { name: '缺 TTS 模型', env: { OPENAI_TTS_MODEL: '' } },
  { name: '缺 voice', env: { OPENAI_TTS_VOICE: '' } },
  { name: '缺輸入單價', env: { OPENAI_PRICE_INPUT_PER_1M_TOKENS: '' } },
  { name: '輸出單價為 0', env: { OPENAI_PRICE_OUTPUT_PER_1M_TOKENS: '0' } },
  { name: 'TTS 單價非數字', env: { OPENAI_PRICE_TTS_PER_1M_CHARS: 'abc' } },
  { name: 'tts-1 不支援 instructions', env: { OPENAI_TTS_MODEL: 'tts-1' } },
  { name: 'tts-1-hd 不支援 instructions', env: { OPENAI_TTS_MODEL: 'tts-1-hd' } },
  { name: '帳本損毀', before: (env) => writeFileSync(env.BUDGET_LEDGER_PATH!, '{broken') },
  { name: '帳本結構不符', before: (env) => writeFileSync(env.BUDGET_LEDGER_PATH!, '{}') },
  { name: '環境緊急停止', env: { REAL_PROVIDERS_KILL_SWITCH: 'true' } },
  { name: '啟動前已有停止檔', before: (env) => writeFileSync(env.KILL_SWITCH_FILE!, 'stop') },
  { name: '執行中放入停止檔', after: (env) => writeFileSync(env.KILL_SWITCH_FILE!, 'stop') },
];

it.each(CASES)('$name：不發任何 HTTP，降級 mock，capabilities 與節目 warnings 都有說明', async ({ env: extra, before, after }) => {
  const globalFetch = vi.fn(() => { throw new Error('禁止真實網路'); });
  vi.stubGlobal('fetch', globalFetch);
  const env = realEnv(extra);
  before?.(env);
  const fetchImpl = fakeOpenAI();
  const { app } = createApp(loadConfig(env), { fetchImpl });
  after?.(env);
  const client = await bootstrap(app);
  const caps = (await client.agent.get('/api/capabilities').expect(200)).body;
  expect(caps.providers).toMatchObject({ llm: 'mock', tts: 'mock' });
  expect(caps.providers.reason).toEqual(expect.any(String));
  expect(caps.restrictions).toContain(caps.providers.reason);
  expect(caps.restrictions.join(' ')).toContain('不是 AI 語音');
  const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  expect(job.status).toBe('completed');
  const show = (await client.agent.get(`/api/shows/${job.showId}`)).body;
  expect(show.segments.every((s: { speech: { kind: string } }) => s.speech.kind === 'mock_chime')).toBe(true);
  expect(show.warnings[0]).toMatch(new RegExp(`^${PROVIDER_NOTICES.llm}`));
  expect(show.warnings[1]).toMatch(new RegExp(`^${PROVIDER_NOTICES.tts}`));
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(globalFetch).not.toHaveBeenCalled();
});

it('預設 env（未設定任何 OpenAI 變數）完全不發 HTTP，capabilities 無降級原因、節目無供應商提示', async () => {
  const globalFetch = vi.fn(() => { throw new Error('禁止真實網路'); });
  vi.stubGlobal('fetch', globalFetch);
  const config = loadConfig({ MOCK_PHASE_MS: '0' });
  expect(config.openai).toMatchObject({ llm: 'mock', tts: 'mock', reason: null });
  const { app } = createApp(config);
  const client = await bootstrap(app);
  expect((await client.agent.get('/api/capabilities')).body.providers).toEqual({ llm: 'mock', tts: 'mock', reason: null });
  const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  const show = (await client.agent.get(`/api/shows/${job.showId}`)).body;
  expect(show.warnings.filter((w: string) => w.startsWith('AI '))).toEqual([]);
  expect(globalFetch).not.toHaveBeenCalled();
});
