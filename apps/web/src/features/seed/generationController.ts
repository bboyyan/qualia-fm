/**
 * One cancellable generation at a time, driven only by real server phases (no fake timers or
 * percentages). Every async continuation checks the active token, so a cancelled or superseded
 * request can never change the screen or start audio (AC04, AC05).
 */
import { TERMINAL_JOB_STATUSES, type ErrorInfo, type JobInfo, type JobPhase, type JobStatus, type MockScenario, type PlanRequest, type ShowPlan } from '@qualia/contracts';
import { ApiError, localError, type ApiClient } from '../../api/client';

export const POLL_INITIAL_MS = 1_200;
export const POLL_MAX_MS = 3_000;
export const POLL_FACTOR = 1.25;
export const LONG_WAIT_MS = 20_000;
export const CLIENT_DEADLINE_MS = 65_000;

export type GenerationStatus = 'idle' | 'running' | 'ready' | 'failed';

export interface GenerationState {
  readonly status: GenerationStatus;
  readonly phase: JobPhase | null;
  readonly request: PlanRequest | null;
  readonly show: ShowPlan | null;
  readonly jobStatus: JobStatus | null;
  readonly error: ErrorInfo | null;
  readonly longWait: boolean;
}

export interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface GenerationDeps {
  api: Pick<ApiClient, 'startPlan' | 'getJob' | 'cancelJob' | 'getShow' | 'ensureSession'>;
  timers: Timers;
  isHidden: () => boolean;
  newKey: () => string;
  scenario: () => MockScenario | undefined;
}

const IDLE: GenerationState = { status: 'idle', phase: null, request: null, show: null, jobStatus: null, error: null, longWait: false };

const toInfo = (error: unknown): ErrorInfo => (error instanceof ApiError ? error.info : localError('INTERNAL').info);

export class GenerationController {
  private state: GenerationState = IDLE;
  private readonly listeners = new Set<() => void>();
  private token = 0;
  private jobId: string | null = null;
  private pollDelay = POLL_INITIAL_MS;
  private pollTimer: unknown = null;
  private pollPending = false;
  private longWaitTimer: unknown = null;
  private deadlineTimer: unknown = null;

  constructor(private readonly deps: GenerationDeps) {}

  getState = (): GenerationState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Starting B while A runs cancels A first; only the newest token may update state. */
  async start(request: PlanRequest): Promise<void> {
    this.abandonActive();
    const token = (this.token += 1);
    this.set({ ...IDLE, status: 'running', phase: 'queued', request });
    this.armTimers(token);
    try {
      const job = await this.deps.api.startPlan(request, { idempotencyKey: this.deps.newKey(), scenario: this.deps.scenario() });
      if (token !== this.token) {
        void this.deps.api.cancelJob(job.jobId).catch(() => undefined);
        return;
      }
      this.jobId = job.jobId;
      await this.handle(job, token);
    } catch (error: unknown) {
      if (token === this.token) this.fail(toInfo(error));
    }
  }

  /** Invalidates the active request; any late response is ignored. Input is kept by the caller. */
  cancel(): void {
    this.abandonActive();
    this.token += 1;
    this.set(IDLE);
  }

  reset(): void {
    this.cancel();
  }

  /** Manual retry of the last request; re-creates the session first if it had expired. */
  async retry(): Promise<void> {
    const request = this.state.request;
    if (!request) return;
    if (this.state.error?.code === 'SESSION_EXPIRED' || this.state.error?.code === 'CSRF_REJECTED') {
      await this.deps.api.ensureSession(true).catch(() => undefined);
    }
    await this.start(request);
  }

  /** Polling pauses while hidden and resumes immediately when the page is visible again. */
  onVisibilityChange(): void {
    if (this.deps.isHidden() || !this.pollPending || this.state.status !== 'running') return;
    this.pollPending = false;
    void this.poll(this.token);
  }

  private async handle(job: JobInfo, token: number): Promise<void> {
    if (token !== this.token) return;
    if (!TERMINAL_JOB_STATUSES.has(job.status)) {
      this.set({ ...this.state, phase: job.phase, jobStatus: job.status });
      this.schedulePoll(token);
      return;
    }
    if (job.status === 'cancelled') return;
    if (job.status === 'failed' || !job.showId) {
      this.fail(job.error ?? localError('INTERNAL').info);
      return;
    }
    const show = await this.deps.api.getShow(job.showId);
    if (token !== this.token) return;
    this.clearTimers();
    this.jobId = null;
    this.set({ ...this.state, status: 'ready', phase: 'done', show, jobStatus: job.status, error: job.error, longWait: false });
  }

  private schedulePoll(token: number): void {
    if (this.deps.isHidden()) {
      this.pollPending = true;
      return;
    }
    const delay = this.pollDelay;
    this.pollDelay = Math.min(POLL_MAX_MS, Math.round(this.pollDelay * POLL_FACTOR));
    this.pollTimer = this.deps.timers.setTimeout(() => void this.poll(token), delay);
  }

  private async poll(token: number): Promise<void> {
    if (token !== this.token || !this.jobId) return;
    try {
      await this.handle(await this.deps.api.getJob(this.jobId), token);
    } catch (error: unknown) {
      if (token === this.token) this.fail(toInfo(error));
    }
  }

  private armTimers(token: number): void {
    this.pollDelay = POLL_INITIAL_MS;
    this.longWaitTimer = this.deps.timers.setTimeout(() => {
      if (token === this.token && this.state.status === 'running') this.set({ ...this.state, longWait: true });
    }, LONG_WAIT_MS);
    this.deadlineTimer = this.deps.timers.setTimeout(() => {
      if (token !== this.token || this.state.status !== 'running') return;
      this.abandonActive();
      this.fail(localError('PLAN_TIMEOUT').info);
    }, CLIENT_DEADLINE_MS);
  }

  private abandonActive(): void {
    if (this.jobId && this.state.status === 'running') void this.deps.api.cancelJob(this.jobId).catch(() => undefined);
    this.jobId = null;
    this.clearTimers();
  }

  private clearTimers(): void {
    for (const handle of [this.pollTimer, this.longWaitTimer, this.deadlineTimer]) {
      if (handle !== null) this.deps.timers.clearTimeout(handle);
    }
    this.pollTimer = this.longWaitTimer = this.deadlineTimer = null;
    this.pollPending = false;
  }

  private fail(error: ErrorInfo): void {
    this.clearTimers();
    this.jobId = null;
    this.set({ ...this.state, status: 'failed', error, longWait: false });
  }

  private set(next: GenerationState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}
