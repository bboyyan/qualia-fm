import { describe, expect, it } from 'vitest';
import type { JobInfo, PlanRequest, ShowPlan } from '@qualia/contracts';
import { ApiError } from '../src/api/client';
import { GenerationController, LONG_WAIT_MS, POLL_INITIAL_MS, type GenerationDeps } from '../src/features/seed/generationController';

const request = (text: string): PlanRequest => ({
  seed: { kind: 'feeling', text, artist: null },
  requestedCount: 5,
  dj: { enabled: true, length: 'short' },
  tuning: null,
});

const job = (jobId: string, patch: Partial<JobInfo> = {}): JobInfo => ({
  jobId,
  generationId: `g-${jobId}`,
  status: 'running',
  phase: 'understanding',
  showId: null,
  error: null,
  ...patch,
});

const show = (showId: string): ShowPlan => ({ showId, segments: [] }) as unknown as ShowPlan;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Manual clock: timers only fire when the test advances time. */
function harness(overrides: Partial<GenerationDeps['api']> = {}) {
  let now = 0;
  let hidden = false;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  const cancelled: string[] = [];
  const jobs = new Map<string, JobInfo>();
  const api: GenerationDeps['api'] = {
    ensureSession: async () => ({ sessionId: 's', csrfToken: 'x'.repeat(16), expiresAt: '2026-10-04T00:00:00.000Z' }),
    startPlan: async (req) => job(`job-${req.seed.text}`),
    getJob: async (id) => jobs.get(id) ?? job(id),
    cancelJob: async (id) => (cancelled.push(id), job(id, { status: 'cancelled' })),
    getShow: async (id) => show(id),
    ...overrides,
  };
  const controller = new GenerationController({
    api,
    timers: {
      setTimeout: (fn, ms) => {
        const id = nextId++;
        timers.set(id, { at: now + ms, fn });
        return id;
      },
      clearTimeout: (id) => timers.delete(id as number),
    },
    isHidden: () => hidden,
    newKey: () => `key-${nextId}`,
    scenario: () => undefined,
  });
  const advance = async (ms: number) => {
    now += ms;
    for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
      if (t.at <= now) {
        timers.delete(id);
        t.fn();
        await flush();
      }
    }
  };
  return { controller, jobs, cancelled, advance, setHidden: (h: boolean) => (hidden = h), pending: () => timers.size };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('GenerationController', () => {
  it('starts in running/queued and reflects the real server phase', async () => {
    const h = harness();
    await h.controller.start(request('a'));
    expect([h.controller.getState().status, h.controller.getState().phase]).toEqual(['running', 'understanding']);
  });

  it('becomes ready with the show once the job completes', async () => {
    const h = harness();
    await h.controller.start(request('a'));
    h.jobs.set('job-a', job('job-a', { status: 'completed', phase: 'done', showId: 'show-a' }));
    await h.advance(POLL_INITIAL_MS);
    expect([h.controller.getState().status, h.controller.getState().show?.showId]).toEqual(['ready', 'show-a']);
  });

  it('ignores a late success after cancel and cancels the job server-side (AC04)', async () => {
    const h = harness();
    await h.controller.start(request('a'));
    h.controller.cancel();
    h.jobs.set('job-a', job('job-a', { status: 'completed', phase: 'done', showId: 'show-a' }));
    await h.advance(POLL_INITIAL_MS * 3);
    expect([h.controller.getState().status, h.cancelled]).toEqual(['idle', ['job-a']]);
  });

  it('lets only the newest generation win when A resolves after B (AC05)', async () => {
    const slowStart = deferred<JobInfo>();
    const h = harness({
      startPlan: async (req) => (req.seed.text === 'A' ? slowStart.promise : job('job-B', { status: 'completed', phase: 'done', showId: 'show-B' })),
    });
    const a = h.controller.start(request('A'));
    await h.controller.start(request('B'));
    slowStart.resolve(job('job-A', { status: 'completed', phase: 'done', showId: 'show-A' }));
    await a;
    expect([h.controller.getState().show?.showId, h.cancelled.includes('job-A')]).toEqual(['show-B', true]);
  });

  it('surfaces a server failure with its typed error', async () => {
    const h = harness();
    await h.controller.start(request('a'));
    h.jobs.set('job-a', job('job-a', { status: 'failed', error: { code: 'PLAN_INVALID', message: 'x', retryable: true, requestId: 'r', retryAfterMs: null } }));
    await h.advance(POLL_INITIAL_MS);
    expect(h.controller.getState().error?.code).toBe('PLAN_INVALID');
  });

  it('flags a long wait after 20 seconds without inventing progress', async () => {
    const h = harness();
    await h.controller.start(request('a'));
    await h.advance(LONG_WAIT_MS);
    expect([h.controller.getState().longWait, h.controller.getState().phase]).toEqual([true, 'understanding']);
  });

  it('stops polling while hidden and polls immediately when visible again', async () => {
    let polls = 0;
    const h = harness({ getJob: async (id) => ((polls += 1), job(id)) });
    h.setHidden(true);
    await h.controller.start(request('a'));
    await h.advance(10_000);
    h.setHidden(false);
    h.controller.onVisibilityChange();
    await flush();
    expect(polls).toBe(1);
  });

  it('re-creates the session before retrying after SESSION_EXPIRED', async () => {
    let sessions = 0;
    let first = true;
    const h = harness({
      ensureSession: async () => ((sessions += 1), { sessionId: 's', csrfToken: 'x'.repeat(16), expiresAt: '2026-10-04T00:00:00.000Z' }),
      startPlan: async () => {
        if (first) {
          first = false;
          throw new ApiError({ code: 'SESSION_EXPIRED', message: '過期', retryable: true, requestId: 'r', retryAfterMs: null }, 401);
        }
        return job('job-2');
      },
    });
    await h.controller.start(request('a'));
    await h.controller.retry();
    expect([sessions, h.controller.getState().status]).toEqual([1, 'running']);
  });

  it('clears all timers when cancelled', async () => {
    const h = harness();
    await h.controller.start(request('a'));
    h.controller.cancel();
    expect(h.pending()).toBe(0);
  });
});
