import request from 'supertest';
import type { Express } from 'express';
import { TERMINAL_JOB_STATUSES, type JobInfo, type PlanRequest } from '@qualia/contracts';
import { loadConfig, type ServerConfig } from '../src/config/env.js';
import { createApp, type AppOverrides, type QualiaApp } from '../src/app.js';

export const ORIGIN = 'http://127.0.0.1:5173';

export function testConfig(env: Record<string, string> = {}): ServerConfig {
  return loadConfig({
    NODE_ENV: 'test',
    MOCK_PHASE_MS: '2',
    MOCK_SLOW_PHASE_MS: '40',
    MOCK_TRACK_MS: '5000',
    MOCK_SPEECH_MS: '800',
    ...env,
  });
}

export function testApp(env: Record<string, string> = {}, overrides: AppOverrides = {}): QualiaApp {
  return createApp(testConfig(env), overrides);
}

export interface Client {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
}

export async function bootstrap(app: Express): Promise<Client> {
  const agent = request.agent(app);
  const res = await agent.post('/api/session').set('Origin', ORIGIN).expect(200);
  return { agent, csrf: String(res.body.csrfToken) };
}

export const planRequest = (overrides: Partial<PlanRequest> = {}): PlanRequest => ({
  seed: { kind: 'feeling', text: 'TEST fake seed', artist: null },
  requestedCount: 5,
  dj: { enabled: true, length: 'short' },
  tuning: null,
  ...overrides,
});

let keyCounter = 0;
export const newKey = (): string => `test-key-${Date.now()}-${(keyCounter += 1)}`;

export function postPlan(client: Client, body: unknown, key = newKey(), scenario?: string) {
  const req = client.agent
    .post('/api/plan')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', client.csrf)
    .set('Idempotency-Key', key);
  return (scenario ? req.set('X-Mock-Scenario', scenario) : req).send(body as object);
}

export async function waitForJob(client: Client, jobId: string, timeoutMs = 3000): Promise<JobInfo> {
  const started = Date.now();
  for (;;) {
    const res = await client.agent.get(`/api/jobs/${jobId}`).expect(200);
    const job = res.body as JobInfo;
    if (TERMINAL_JOB_STATUSES.has(job.status)) return job;
    if (Date.now() - started > timeoutMs) throw new Error(`job ${jobId} still ${job.status}/${job.phase}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
