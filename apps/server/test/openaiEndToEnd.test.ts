import { readdirSync } from 'node:fs';
import request from 'supertest';
import { expect, it } from 'vitest';
import { PROVIDER_NOTICES, ShowPlanSchema } from '@qualia/contracts';
import { createApp } from '../src/app.js';
import { ORIGIN, bootstrap, planRequest, postPlan, waitForJob } from './helpers.js';
import { MP3_BYTES, fakeOpenAI, realConfig, responsesBody, validDraftText } from './openaiHelpers.js';

async function realShow(config = realConfig(), fetchImpl = fakeOpenAI()) {
  const { app } = createApp(config, { fetchImpl });
  const client = await bootstrap(app);
  const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  const show = ShowPlanSchema.parse((await client.agent.get(`/api/shows/${job.showId}`).expect(200)).body);
  return { app, client, job, show, fetchImpl, config };
}

const speechUrl = (segment: { speech: { kind: string; url?: string } } | undefined): string => (segment?.speech.kind === 'ai_audio' ? segment.speech.url! : '');

it('真實 LLM → schema 驗證 → TTS 進 segment（ai_audio、aiVoice、私有同源 hash URL），無降級提示', async () => {
  const { job, show, fetchImpl, client } = await realShow();
  expect(job.status).toBe('completed');
  expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/responses'))).toHaveLength(1);
  expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/audio/speech'))).toHaveLength(show.segments.length);
  for (const segment of show.segments) {
    expect(segment.speech).toMatchObject({ kind: 'ai_audio', aiVoice: true });
    expect(speechUrl(segment)).toMatch(new RegExp(`^/api/media/tts/${show.showId}/${segment.segmentId}/[a-f0-9]{64}$`));
  }
  expect(show.warnings.filter((w) => w.startsWith(PROVIDER_NOTICES.llm) || w.startsWith(PROVIDER_NOTICES.tts))).toEqual([]);
  const caps = (await client.agent.get('/api/capabilities')).body;
  expect(caps.providers).toEqual({ llm: 'openai', tts: 'openai', reason: null });
  expect(caps.restrictions.join(' ')).not.toContain('不是 AI 語音');
});

it('/api/media/tts：需 session、僅本人節目、僅 hash 檔名、不可穿越；有安全標頭並支援 iPhone 需要的 Range', async () => {
  const { app, client, show, config } = await realShow();
  const url = speechUrl(show.segments[0]);
  const full = await client.agent.get(url).buffer(true).expect(200);
  expect(full.headers['content-type']).toBe('audio/mpeg');
  expect(full.headers['cache-control']).toBe('private, no-store');
  expect(full.headers['x-content-type-options']).toBe('nosniff');
  expect(full.headers['content-security-policy']).toBeTruthy();
  expect(full.headers['accept-ranges']).toBe('bytes');
  expect(Buffer.from(full.body)).toEqual(Buffer.from(MP3_BYTES));
  const partial = await client.agent.get(url).set('Range', 'bytes=0-1').buffer(true).expect(206);
  expect(partial.headers['content-range']).toBe(`bytes 0-1/${MP3_BYTES.length}`);
  expect(Buffer.from(partial.body)).toEqual(Buffer.from(MP3_BYTES.slice(0, 2)));

  await request(app).get(url).expect(401);
  await (await bootstrap(app)).agent.get(url).expect(404);
  const prefix = url.slice(0, url.lastIndexOf('/'));
  const key = url.split('/').at(-1)!;
  const otherKey = speechUrl(show.segments[1]).split('/').at(-1)!;
  await client.agent.get(`${prefix}/${otherKey}`).expect(404);
  for (const bad of [`${prefix}/${key.toUpperCase()}`, `${prefix}/..%2F..%2Fledger.json`, `${prefix}/${key}.mp3`, `${prefix}/%2e%2e`, `/api/media/tts/${key}`]) {
    await client.agent.get(bad).expect(404);
  }
  expect(readdirSync(config.openai.cacheDir).every((name) => /^[a-f0-9]{64}\.mp3$/.test(name))).toBe(true);
  await client.agent.post(url).set('Origin', ORIGIN).set('X-CSRF-Token', client.csrf).expect(404);
});

it('LLM 供應商錯誤：降級 MOCK 選歌、節目完成、warnings 第一則為明示提示', async () => {
  const fetchImpl = fakeOpenAI({ responses: () => new Response('upstream down', { status: 500 }) });
  const { job, show } = await realShow(realConfig({ TTS_PROVIDER: 'mock' }), fetchImpl);
  expect(job.status).toBe('completed');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(show.warnings[0]).toMatch(new RegExp(`^${PROVIDER_NOTICES.llm}：`));
});

it('LLM 兩次輸出都無效：只呼叫兩次（初次＋修復），然後降級 MOCK 並明示，不讓整輪失敗', async () => {
  const fetchImpl = fakeOpenAI({ responses: () => Response.json(responsesBody('{broken')) });
  const { job, show } = await realShow(realConfig({ TTS_PROVIDER: 'mock' }), fetchImpl);
  expect(job.status).toBe('completed');
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(show.warnings[0]).toMatch(new RegExp(`^${PROVIDER_NOTICES.llm}：`));
});

it('模型拒答（refusal）也降級並明示', async () => {
  const refusal = { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }], usage: { input_tokens: 1, output_tokens: 1 } };
  const { job, show } = await realShow(realConfig({ TTS_PROVIDER: 'mock' }), fakeOpenAI({ responses: () => Response.json(refusal) }));
  expect(job.status).toBe('completed');
  expect(show.warnings[0]).toMatch(new RegExp(`^${PROVIDER_NOTICES.llm}`));
});

it('模型 warnings 已滿 10 則時，供應商提示仍排在最前面不被截掉', async () => {
  const draft = JSON.parse(await validDraftText());
  const crowded = JSON.stringify({ ...draft, warnings: Array.from({ length: 10 }, (_, i) => `模型提醒 ${i}`) });
  const fetchImpl = fakeOpenAI({ responses: () => Response.json(responsesBody(crowded)), speech: () => new Response('no', { status: 500 }) });
  const { show } = await realShow(realConfig(), fetchImpl);
  expect(show.warnings).toHaveLength(10);
  expect(show.warnings[0]).toMatch(new RegExp(`^${PROVIDER_NOTICES.tts}：`));
});

it('TTS 失敗：保留文字介紹＋提示音（不是靜默無介紹），明示提示，且本輪第一次失敗後不再重試其他段落', async () => {
  const fetchImpl = fakeOpenAI({ speech: () => new Response('bad voice', { status: 400 }) });
  const { job, show } = await realShow(realConfig({ LLM_PROVIDER: 'mock' }), fetchImpl);
  expect(job.status).toBe('completed');
  expect(show.segments.length).toBeGreaterThan(1);
  expect(show.segments.every((s) => s.speech.kind === 'mock_chime' && s.candidate.djLine.length > 0)).toBe(true);
  expect(show.warnings[0]).toMatch(new RegExp(`^${PROVIDER_NOTICES.tts}：`));
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
