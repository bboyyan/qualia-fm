import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ORIGIN, bootstrap, planRequest, postPlan, testApp } from './helpers.js';

describe('health and session', () => {
  it('GET /api/health returns only {ok:true}', async () => {
    const res = await request(testApp().app).get('/api/health').expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('sets an HttpOnly SameSite=Lax session cookie', async () => {
    const res = await request(testApp().app).post('/api/session').set('Origin', ORIGIN).expect(200);
    expect(String(res.headers['set-cookie'])).toMatch(/qfm_sid=.+; Path=\/; HttpOnly; SameSite=Lax/);
  });

  it('marks the cookie Secure when the app origin is HTTPS', async () => {
    const { app } = testApp({ APP_ORIGIN: 'https://qualia.example.test' });
    const res = await request(app).post('/api/session').set('Origin', 'https://qualia.example.test').expect(200);
    expect(String(res.headers['set-cookie'])).toContain('; Secure');
  });

  it('restores the same session on a repeated POST /api/session', async () => {
    const { agent } = await bootstrap(testApp().app);
    const a = await agent.post('/api/session').set('Origin', ORIGIN).expect(200);
    const b = await agent.post('/api/session').set('Origin', ORIGIN).expect(200);
    expect(a.body.csrfToken).toBe(b.body.csrfToken);
  });

  it('rejects session creation from a foreign origin', async () => {
    const res = await request(testApp().app).post('/api/session').set('Origin', 'https://evil.example').expect(403);
    expect(res.body.error.code).toBe('ORIGIN_REJECTED');
  });

  it('rate limits session creation per client', async () => {
    const { app } = testApp({ SESSION_RATE_LIMIT_PER_MIN: '2' });
    await request(app).post('/api/session').set('Origin', ORIGIN).expect(200);
    await request(app).post('/api/session').set('Origin', ORIGIN).expect(200);
    const res = await request(app).post('/api/session').set('Origin', ORIGIN).expect(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('session and CSRF enforcement', () => {
  it('requires a session for capabilities', async () => {
    const res = await request(testApp().app).get('/api/capabilities').expect(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('rejects a POST without the CSRF header (AC30)', async () => {
    const client = await bootstrap(testApp().app);
    const res = await client.agent.post('/api/plan').set('Origin', ORIGIN).set('Idempotency-Key', 'abcdefgh1').send(planRequest());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
  });

  it('rejects a POST with a valid token from a foreign origin', async () => {
    const client = await bootstrap(testApp().app);
    const res = await client.agent
      .post('/api/plan')
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', client.csrf)
      .set('Idempotency-Key', 'abcdefgh2')
      .send(planRequest());
    expect(res.body.error.code).toBe('ORIGIN_REJECTED');
  });

  it("does not let one session read another session's job (AC30)", async () => {
    const { app } = testApp();
    const alice = await bootstrap(app);
    const bob = await bootstrap(app);
    const job = await postPlan(alice, planRequest()).expect(202);
    const res = await bob.agent.get(`/api/jobs/${job.body.jobId}`).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('logout clears the session and later calls are rejected (AC31)', async () => {
    const client = await bootstrap(testApp().app);
    await client.agent.post('/api/auth/logout').set('Origin', ORIGIN).set('X-CSRF-Token', client.csrf).expect(204);
    await client.agent.get('/api/capabilities').expect(401);
  });

  it('sends no-store and baseline security headers on API responses', async () => {
    const res = await request(testApp().app).get('/api/health');
    expect([res.headers['cache-control'], res.headers['x-content-type-options']]).toEqual(['no-store', 'nosniff']);
  });

  it('returns a typed envelope (not a stack trace) for malformed JSON', async () => {
    const client = await bootstrap(testApp().app);
    const res = await client.agent
      .post('/api/plan')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', client.csrf)
      .set('Idempotency-Key', 'abcdefgh3')
      .set('Content-Type', 'application/json')
      .send('{"seed":');
    expect([res.status, res.body.error.code]).toEqual([400, 'INVALID_INPUT']);
  });

  it('answers unknown API paths with a NOT_FOUND envelope', async () => {
    const client = await bootstrap(testApp().app);
    const res = await client.agent.get('/api/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
