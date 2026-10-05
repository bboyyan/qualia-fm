import { describe, expect, it } from 'vitest';
import type { ApiError} from '../src/api/client';
import { createApiClient } from '../src/api/client';

const session = { sessionId: 'abc', csrfToken: 'csrf-token-0123456789', expiresAt: '2026-10-04T18:00:00.000Z' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('createApiClient', () => {
  it('sends the in-memory CSRF token and idempotency key on plan start', async () => {
    const seen: RequestInit[] = [];
    const client = createApiClient(async (url, init) => {
      seen.push(init ?? {});
      if (url === '/api/session') return json(200, session);
      return json(202, { jobId: 'j1', generationId: 'g1', status: 'queued', phase: 'queued', showId: null, error: null });
    });
    await client.startPlan(
      { seed: { kind: 'feeling', text: '夜', artist: null }, requestedCount: 5, dj: { enabled: true, length: 'short' }, tuning: null },
      { idempotencyKey: 'plan_abcdefgh' },
    );
    const headers = seen[1]?.headers as Record<string, string>;
    expect([headers['X-CSRF-Token'], headers['Idempotency-Key']]).toEqual([session.csrfToken, 'plan_abcdefgh']);
  });

  it('turns an ErrorEnvelope into a typed ApiError', async () => {
    const client = createApiClient(async () =>
      json(429, { error: { code: 'RATE_LIMITED', message: '稍後再試', retryable: true, requestId: 'r1', retryAfterMs: 1000 } }),
    );
    const error = await client.capabilities().catch((e: unknown) => e);
    expect([(error as ApiError).code, (error as ApiError).status]).toEqual(['RATE_LIMITED', 429]);
  });

  it('maps a network failure to NETWORK_ERROR rather than a raw exception', async () => {
    const client = createApiClient(async () => {
      throw new TypeError('Failed to fetch');
    });
    const error = await client.capabilities().catch((e: unknown) => e);
    expect((error as ApiError).code).toBe('NETWORK_ERROR');
  });

  it('rejects a malformed success body instead of trusting it', async () => {
    const client = createApiClient(async () => json(200, { mode: 'spotify', spotifyEnabled: true }));
    const error = await client.capabilities().catch((e: unknown) => e);
    expect((error as ApiError).code).toBe('INTERNAL');
  });

  it('creates the session only once for concurrent callers', async () => {
    let calls = 0;
    const client = createApiClient(async () => ((calls += 1), json(200, session)));
    await Promise.all([client.ensureSession(), client.ensureSession()]);
    expect(calls).toBe(1);
  });

  it('品味帳本：編輯帶 CSRF，紀錄查詢把 trackKey 編進網址（BRA-135）', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const mark = { trackKey: '夜行者 — 遠方的燈', title: '遠方的燈', artist: '夜行者', mark: 'pinned', rating: null, note: null, lastAiredAt: null, updatedAt: '2026-10-05T12:00:00.000Z' };
    const client = createApiClient(async (url, init) => {
      seen.push({ url, init: init ?? {} });
      if (url === '/api/session') return json(200, session);
      if (url.startsWith('/api/taste/history')) return json(200, { entries: [] });
      return json(200, mark);
    });
    expect(await client.tasteEdit({ target: { trackKey: mark.trackKey }, mark: 'pinned' })).toEqual(mark);
    expect((seen[1]?.init.headers as Record<string, string>)['X-CSRF-Token']).toBe(session.csrfToken);
    expect(JSON.parse(String(seen[1]?.init.body))).toEqual({ target: { trackKey: mark.trackKey }, mark: 'pinned' });
    await client.tasteHistory(mark.trackKey);
    expect(seen[2]?.url).toBe(`/api/taste/history?trackKey=${encodeURIComponent(mark.trackKey)}`);
  });
});
