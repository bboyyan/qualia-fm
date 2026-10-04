import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { PlanRequest } from '@qualia/contracts';
import { EDITORIAL_INPUT_KEYS, toEditorialInput, type EditorialInput } from '../src/services/editorialInput.js';
import { ORIGIN, bootstrap, planRequest, postPlan, testApp, waitForJob } from './helpers.js';

describe('provider gates are server enforced (AC27)', () => {
  it('reports Spotify and Spotify+DJ as disabled in capabilities', async () => {
    const client = await bootstrap(testApp().app);
    const res = await client.agent.get('/api/capabilities?spotifyEnabled=true').expect(200);
    expect([res.body.mode, res.body.spotifyEnabled, res.body.spotifyDjApproved, res.body.canOverlap]).toEqual([
      'mock',
      false,
      false,
      false,
    ]);
  });

  it.each(['/api/auth/spotify/start', '/api/auth/spotify/callback?code=x&state=y', '/api/auth/spotify/token'])(
    'refuses %s with FEATURE_RESTRICTED even with override params',
    async (path) => {
      const res = await request(testApp().app).get(`${path}${path.includes('?') ? '&' : '?'}spotify=1&override=true`);
      expect([res.status, res.body.error.code]).toEqual([403, 'FEATURE_RESTRICTED']);
    },
  );

  it('refuses TTS synthesis in mock mode (no AI voice is produced)', async () => {
    const client = await bootstrap(testApp().app);
    const res = await client.agent
      .post('/api/tts')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', client.csrf)
      .send({ showId: 'x', segmentId: 'y', variant: 'seed', voiceId: 'mock' });
    expect([res.status, res.body.error.code]).toEqual([403, 'FEATURE_RESTRICTED']);
  });

  it('rejects a plan request that smuggles gate overrides in the body', async () => {
    const client = await bootstrap(testApp().app);
    const res = await postPlan(client, { ...planRequest(), spotifyEnabled: true, mode: 'spotify' }).expect(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });
});

describe('editorial payload firewall (AC28)', () => {
  it('builds the planner DTO from an allowlist and drops smuggled fields', () => {
    const smuggled = {
      ...planRequest(),
      spotifyResponse: { artwork: 'x', lyrics: 'y' },
      accessToken: 'secret-token',
    } as unknown as PlanRequest;
    expect(Object.keys(toEditorialInput(smuggled)).sort()).toEqual([...EDITORIAL_INPUT_KEYS].sort());
  });

  it('only ever hands the planner the allowlisted DTO', async () => {
    const seen: EditorialInput[] = [];
    const planner = {
      draft: async (input: EditorialInput) => {
        seen.push(input);
        return {};
      },
    };
    const client = await bootstrap(testApp({}, { planner }).app);
    await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
    expect(seen.every((input) => Object.keys(input).every((k) => EDITORIAL_INPUT_KEYS.includes(k as keyof EditorialInput)))).toBe(true);
  });
});
