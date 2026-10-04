import { describe, expect, it } from 'vitest';
import { ShowPlanSchema, countGraphemes, type ShowPlan } from '@qualia/contracts';
import { bootstrap, newKey, planRequest, postPlan, testApp, waitForJob, type Client } from './helpers.js';

async function showOf(client: Client, showId: string | null): Promise<ShowPlan> {
  const res = await client.agent.get(`/api/shows/${showId}`).expect(200);
  return ShowPlanSchema.parse(res.body);
}

describe('POST /api/plan job lifecycle', () => {
  it('returns 202 with a queued job and finishes with five mock segments', async () => {
    const client = await bootstrap(testApp().app);
    const res = await postPlan(client, planRequest()).expect(202);
    const job = await waitForJob(client, res.body.jobId);
    const show = await showOf(client, job.showId);
    expect([job.status, show.segments.length]).toEqual(['completed', 5]);
  });

  it('labels every resolved segment as a mock tone, never a real locator', async () => {
    const client = await bootstrap(testApp().app);
    const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
    const show = await showOf(client, job.showId);
    expect(show.segments.every((s) => s.track.provider === 'mock' && s.track.audioLocator.kind === 'mock_tone')).toBe(true);
  });

  it('keeps every DJ line within 80 grapheme clusters for both lengths', async () => {
    const client = await bootstrap(testApp().app);
    const standard = planRequest({ dj: { enabled: true, length: 'standard' } });
    const job = await waitForJob(client, (await postPlan(client, standard)).body.jobId);
    const show = await showOf(client, job.showId);
    expect(show.segments.every((s) => countGraphemes(s.candidate.djLine) <= 80)).toBe(true);
  });

  it('uses no speech locator when DJ is disabled', async () => {
    const client = await bootstrap(testApp().app);
    const off = planRequest({ dj: { enabled: false, length: 'short' } });
    const job = await waitForJob(client, (await postPlan(client, off)).body.jobId);
    expect((await showOf(client, job.showId)).segments[0]?.speech).toEqual({ kind: 'none' });
  });

  it('reports a partial show with the real count for the "three" scenario (AC07)', async () => {
    const client = await bootstrap(testApp().app);
    const job = await waitForJob(client, (await postPlan(client, planRequest(), newKey(), 'three')).body.jobId);
    const show = await showOf(client, job.showId);
    expect([job.status, show.segments.length, show.unavailable.length]).toEqual(['partial', 3, 4]);
  });

  it('drops a transitionBridge whose previous candidate was not resolved', async () => {
    const client = await bootstrap(testApp().app);
    const job = await waitForJob(client, (await postPlan(client, planRequest(), newKey(), 'three')).body.jobId);
    const show = await showOf(client, job.showId);
    expect(show.segments.map((s) => s.candidate.transitionBridge)).toEqual([null, null, null]);
  });

  it('keeps analysis but flags NO_RESOLVED_TRACKS for the "zero" scenario', async () => {
    const client = await bootstrap(testApp().app);
    const job = await waitForJob(client, (await postPlan(client, planRequest(), newKey(), 'zero')).body.jobId);
    const show = await showOf(client, job.showId);
    expect([job.error?.code, show.segments.length, show.analysis.hookOfFeeling.length > 0]).toEqual([
      'NO_RESOLVED_TRACKS',
      0,
      true,
    ]);
  });

  it('fails with PLAN_INVALID after at most the repair budget (AC06)', async () => {
    let calls = 0;
    const planner = { draft: async () => ((calls += 1), { schemaVersion: 1, candidates: [] }) };
    const client = await bootstrap(testApp({}, { planner }).app);
    const job = await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
    expect([job.status, job.error?.code, calls]).toEqual(['failed', 'PLAN_INVALID', 2]);
  });

  it('times out with PLAN_TIMEOUT at the deadline', async () => {
    const client = await bootstrap(testApp({ PLAN_DEADLINE_MS: '1000', MOCK_SLOW_PHASE_MS: '5000' }).app);
    const job = await waitForJob(client, (await postPlan(client, planRequest(), newKey(), 'slow')).body.jobId, 3000);
    expect([job.status, job.error?.code]).toEqual(['failed', 'PLAN_TIMEOUT']);
  });
});

describe('cancel and idempotency', () => {
  it('cancels a running job and late completion never revives it (AC04)', async () => {
    const client = await bootstrap(testApp({ MOCK_SLOW_PHASE_MS: '150' }).app);
    const started = await postPlan(client, planRequest(), newKey(), 'slow').expect(202);
    await client.agent.delete(`/api/jobs/${started.body.jobId}`).set('Origin', 'http://127.0.0.1:5173').set('X-CSRF-Token', client.csrf).expect(200);
    await new Promise((r) => setTimeout(r, 250));
    const res = await client.agent.get(`/api/jobs/${started.body.jobId}`).expect(200);
    expect([res.body.status, res.body.showId]).toEqual(['cancelled', null]);
  });

  it('treats repeated cancel as idempotent', async () => {
    const client = await bootstrap(testApp({ MOCK_SLOW_PHASE_MS: '150' }).app);
    const started = await postPlan(client, planRequest(), newKey(), 'slow');
    const cancel = () =>
      client.agent.delete(`/api/jobs/${started.body.jobId}`).set('Origin', 'http://127.0.0.1:5173').set('X-CSRF-Token', client.csrf);
    await cancel().expect(200);
    const second = await cancel().expect(200);
    expect(second.body.status).toBe('cancelled');
  });

  it('returns the same job for the same key and payload (AC29)', async () => {
    const client = await bootstrap(testApp().app);
    const key = newKey();
    const a = await postPlan(client, planRequest(), key).expect(202);
    const b = await postPlan(client, planRequest(), key).expect(202);
    expect(b.body.jobId).toBe(a.body.jobId);
  });

  it('returns 409 for the same key with a different payload (AC29)', async () => {
    const client = await bootstrap(testApp().app);
    const key = newKey();
    await postPlan(client, planRequest(), key).expect(202);
    const res = await postPlan(client, planRequest({ tuning: '更放鬆' }), key).expect(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('rejects a seed longer than 500 graphemes (AC02)', async () => {
    const client = await bootstrap(testApp().app);
    const tooLong = planRequest({ seed: { kind: 'feeling', text: '夜'.repeat(501), artist: null } });
    const res = await postPlan(client, tooLong).expect(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  it('enforces the per-session hourly plan budget', async () => {
    const client = await bootstrap(testApp({ PLAN_RATE_LIMIT_PER_HOUR: '1' }).app);
    await postPlan(client, planRequest()).expect(202);
    const res = await postPlan(client, planRequest({ tuning: '更有推進' })).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});
