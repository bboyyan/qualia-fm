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

const expired = () => json(401, { error: { code: 'SESSION_EXPIRED', message: '工作階段已過期', retryable: true, requestId: 'TEST-expired', retryAfterMs: null } });
const feedback = { showId: 'show_TEST', segmentId: 'segment_TEST', rating: '愛', reason: 'TEST kept', clientRequestId: 'TEST-intent' } as const;

describe('BRA-161 V2：有界 session 恢復', () => {
  it('feedback 過期 → 重建 session → 用新 CSRF 原樣重送一次', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    let sessions = 0;
    let attempts = 0;
    const client = createApiClient(async (url, init) => {
      seen.push({ url, init: init ?? {} });
      if (url === '/api/session') return json(200, { ...session, csrfToken: `${session.csrfToken}-${++sessions}` });
      return ++attempts === 1 ? expired() : json(201, { mode: 'fake', rowId: 'TEST-row' });
    });
    await expect(client.feedback(feedback)).resolves.toEqual({ mode: 'fake', rowId: 'TEST-row' });
    expect(seen.map((s) => s.url)).toEqual(['/api/session', '/api/feedback', '/api/session', '/api/feedback']);
    expect(seen[1]!.init.body).toBe(seen[3]!.init.body);
    expect(seen[3]!.init.headers).toMatchObject({ 'X-CSRF-Token': `${session.csrfToken}-2` });
  });

  it.each(['feedback', 'tasteMarks', 'tasteHistory', 'tasteEdit'] as const)('%s 連續 401 最多重送一次，錯誤交給 UI', async (method) => {
    const paths: string[] = [];
    const client = createApiClient(async (url) => {
      paths.push(url);
      return url === '/api/session' ? json(200, session) : expired();
    });
    await client.ensureSession();
    const operation = () => method === 'feedback' ? client.feedback(feedback)
      : method === 'tasteMarks' ? client.tasteMarks()
      : method === 'tasteHistory' ? client.tasteHistory('TEST-track')
      : client.tasteEdit({ target: { trackKey: 'TEST-track' }, mark: 'blocked' });
    await expect(operation()).rejects.toMatchObject({ code: 'SESSION_EXPIRED', status: 401 });
    expect(paths.filter((p) => p === '/api/session')).toHaveLength(2);
    expect(paths.filter((p) => p !== '/api/session')).toHaveLength(2);
  });

  it('並行／晚到的舊 401 共用一次恢復', async () => {
    let sessions = 0;
    let reads = 0;
    let late!: (response: Response) => void;
    const client = createApiClient(async (url) => {
      if (url === '/api/session') return json(200, { ...session, csrfToken: `${session.csrfToken}-${++sessions}` });
      reads += 1;
      if (reads === 1) return new Promise<Response>((resolve) => { late = resolve; });
      if (reads === 2) return expired();
      return json(200, { marks: [] });
    });
    await client.ensureSession();
    const first = client.tasteMarks();
    await expect(client.tasteMarks()).resolves.toEqual([]);
    late(expired());
    await expect(first).resolves.toEqual([]);
    expect(sessions).toBe(2);
    expect(reads).toBe(4);
  });

  it('並行失效請求共用尚未完成的 session POST', async () => {
    let sessions = 0;
    let reads = 0;
    let release!: (response: Response) => void;
    const client = createApiClient(async (url) => {
      if (url === '/api/session') {
        sessions += 1;
        if (sessions === 2) return new Promise<Response>((resolve) => { release = resolve; });
        return json(200, session);
      }
      return ++reads <= 3 ? expired() : json(200, { marks: [] });
    });
    await client.ensureSession();
    const results = [client.tasteMarks(), client.tasteMarks(), client.tasteMarks()];
    // Let all rejected responses reach the shared pending POST before releasing it.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(sessions).toBe(2);
    release(json(200, { ...session, csrfToken: `${session.csrfToken}-new` }));
    await expect(Promise.all(results)).resolves.toEqual([[], [], []]);
    expect(sessions).toBe(2);
    expect(reads).toBe(6);
  });

  it('session 建立失敗就停止；其他錯誤不重送；取消不啟動恢復', async () => {
    let sessionCalls = 0;
    let feedbackCalls = 0;
    const client = createApiClient(async (url) => {
      if (url === '/api/session') return ++sessionCalls === 1 ? json(200, session) : json(503, {});
      feedbackCalls += 1;
      return expired();
    });
    await expect(client.feedback(feedback)).rejects.toMatchObject({ status: 503 });
    expect(feedbackCalls).toBe(1);
    const paths: string[] = [];
    const other = createApiClient(async (url) => { paths.push(url); return url === '/api/session' ? json(200, session) : json(403, {}); });
    await expect(other.feedback(feedback)).rejects.toMatchObject({ status: 403 });
    expect(paths).toHaveLength(2);
    const abort = new AbortController();
    const canceled = createApiClient(async () => { abort.abort(); return expired(); });
    await expect(canceled.tasteMarks(abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
