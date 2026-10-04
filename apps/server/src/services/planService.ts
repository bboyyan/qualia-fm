/**
 * Cancellable, idempotent plan jobs with real phases, a hard deadline and a bounded LLM budget
 * (docs/08 JobInfo, docs/09 budget). Late work after cancel/timeout can never update a job.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  PlanDraftSchema,
  CONFIRMED_SEED,
  type Candidate,
  type FeedbackRequest,
  type JobInfo,
  type JobPhase,
  type MockScenario,
  type PlanDraft,
  type PlanRequest,
  type ShowPlan,
} from '@qualia/contracts';
import type { FeedbackLedger } from '../ledger/types.js';
import type { ServerConfig } from '../config/env.js';
import { AppError, errorEnvelope, newRequestId } from '../http/errors.js';
import type { CatalogResolver, EditorialPlanner, PhaseClock } from '../providers/types.js';
import { WindowLimiter } from '../security/rateLimit.js';
import type { JobStore} from '../stores/jobStore.js';
import { toJobInfo, type JobRecord } from '../stores/jobStore.js';
import { toEditorialInput, type EditorialInput } from './editorialInput.js';
import { buildShowPlan, type ResolvedCandidate } from './showBuilder.js';

const HOUR_MS = 60 * 60 * 1000;
const MAX_ACTIVE_JOBS_PER_SESSION = 3;
const GLOBAL_PLAN_CAP_PER_HOUR = 1_000;
const TARGET_SEGMENTS = 5;

export interface PlanServiceDeps {
  readonly ledger: FeedbackLedger;
  readonly config: ServerConfig;
  readonly planner: EditorialPlanner;
  readonly resolver: CatalogResolver;
  readonly store: JobStore;
  readonly clock: PhaseClock;
  readonly now: () => number;
}

export interface StartPlanInput {
  readonly ownerId: string;
  readonly request: PlanRequest;
  readonly idempotencyKey: string;
  readonly scenario: MockScenario;
}

const id = (prefix: string): string => `${prefix}_${randomBytes(8).toString('hex')}`;

export const realClock: PhaseClock = {
  wait: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true });
    }),
};

export class PlanService {
  private readonly sessionLimiter: WindowLimiter;
  private readonly globalLimiter = new WindowLimiter(GLOBAL_PLAN_CAP_PER_HOUR, HOUR_MS);

  constructor(private readonly deps: PlanServiceDeps) {
    this.sessionLimiter = new WindowLimiter(deps.config.limits.planRateLimitPerHour, HOUR_MS);
  }

  start(input: StartPlanInput): JobInfo {
    const payloadHash = createHash('sha256').update(JSON.stringify([input.request, input.scenario])).digest('hex');
    const existing = this.deps.store.byIdempotencyKey(input.ownerId, input.idempotencyKey);
    if (existing) {
      if (existing.payloadHash !== payloadHash) throw new AppError('IDEMPOTENCY_CONFLICT');
      return toJobInfo(existing);
    }
    this.assertWithinBudget(input.ownerId);
    const job: JobRecord = {
      jobId: id('job'),
      generationId: id('gen'),
      ownerId: input.ownerId,
      status: 'queued',
      phase: 'queued',
      showId: null,
      error: null,
      payloadHash,
      idempotencyKey: input.idempotencyKey,
      controller: new AbortController(),
      createdAt: this.deps.now(),
    };
    this.deps.store.add(job);
    void this.run(job, input);
    return toJobInfo(job);
  }

  get(ownerId: string, jobId: string): JobInfo {
    return toJobInfo(this.owned(ownerId, jobId));
  }

  /** Idempotent: cancelling a finished or already-cancelled job returns its current state. */
  cancel(ownerId: string, jobId: string): JobInfo {
    const job = this.owned(ownerId, jobId);
    if (job.status !== 'queued' && job.status !== 'running') return toJobInfo(job);
    const updated = this.deps.store.update(jobId, { status: 'cancelled' }) ?? job;
    job.controller.abort('cancel');
    return toJobInfo(updated);
  }

  show(ownerId: string, showId: string): ShowPlan {
    const plan = this.deps.store.getShow(showId, ownerId);
    if (!plan) throw new AppError('NOT_FOUND');
    return plan;
  }

  async feedback(ownerId: string, request: FeedbackRequest) {
    const show = this.show(ownerId, request.showId);
    const segment = show.segments.find((s) => s.segmentId === request.segmentId);
    if (!segment) throw new AppError('NOT_FOUND');
    return this.deps.ledger.append({
      date: new Date(this.deps.now()).toISOString(),
      seed: [show.seed.artist, show.seed.text].filter(Boolean).join(' — '),
      recommendation: `${segment.candidate.artist} — ${segment.candidate.title}`,
      rating: request.rating,
      reason: request.reason,
    });
  }

  /** Logout / session end: abort in-flight work and forget everything the owner had. */
  forgetOwner(ownerId: string): void {
    for (const job of this.deps.store.ownedBy(ownerId)) job.controller.abort('cancel');
    this.deps.store.forgetOwner(ownerId);
  }

  private owned(ownerId: string, jobId: string): JobRecord {
    const job = this.deps.store.get(jobId, ownerId);
    if (!job) throw new AppError('NOT_FOUND');
    return job;
  }

  private assertWithinBudget(ownerId: string): void {
    if (this.deps.store.activeCount(ownerId) >= MAX_ACTIVE_JOBS_PER_SESSION) throw new AppError('RATE_LIMITED');
    const now = this.deps.now();
    const global = this.globalLimiter.hit('global', now);
    if (!global.ok) throw new AppError('QUOTA_EXCEEDED', { retryAfterMs: global.retryAfterMs });
    const session = this.sessionLimiter.hit(ownerId, now);
    if (!session.ok) throw new AppError('RATE_LIMITED', { retryAfterMs: session.retryAfterMs });
  }

  private async run(job: JobRecord, input: StartPlanInput): Promise<void> {
    const { signal } = job.controller;
    const deadline = setTimeout(() => job.controller.abort('timeout'), this.deps.config.limits.planDeadlineMs);
    deadline.unref?.();
    try {
      let request = input.request;
      let warning: string | null = null;
      let history: EditorialInput['history'] = [];
      try {
        history = await this.deps.ledger.read(signal);
      } catch {
        if (signal.aborted) throw signal.reason;
        request = { ...request, seed: { ...CONFIRMED_SEED }, tuning: null };
        warning = '未讀到帳本：本輪只用種子曲。';
      }
      if (signal.aborted) throw signal.reason;
      const editorial = { ...toEditorialInput(request), history };
      const result = await this.pipeline(job.jobId, editorial, { ...input, request }, signal);
      const plan = warning ? { ...result, warnings: [...result.warnings, warning] } : result;
      this.deps.store.putShow(job.ownerId, plan, this.deps.now());
      this.finish(job, plan);
    } catch (error: unknown) {
      this.fail(job.jobId, signal, error);
    } finally {
      clearTimeout(deadline);
    }
  }

  private async pipeline(jobId: string, editorial: EditorialInput, input: StartPlanInput, signal: AbortSignal): Promise<ShowPlan> {
    const { phaseMs, slowPhaseMs, speechMs } = this.deps.config.mock;
    await this.enter(jobId, 'understanding', phaseMs, signal);
    const draft = await this.draftWithRepair(editorial, input.scenario, signal);
    await this.enter(jobId, 'matching', input.scenario === 'slow' ? slowPhaseMs : phaseMs, signal);
    await this.enter(jobId, 'resolving', phaseMs, signal);
    const { playable, unavailable } = await this.resolveAll(draft.candidates, input.scenario, signal);
    await this.enter(jobId, 'preparing', phaseMs, signal);
    return buildShowPlan({
      seed: input.request.seed,
      draft,
      playable,
      unavailable,
      speech: editorial.djEnabled ? { kind: 'mock_chime', durationMs: speechMs } : { kind: 'none' },
      now: this.deps.now(),
    });
  }

  private async enter(jobId: string, phase: JobPhase, waitMs: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw signal.reason;
    this.deps.store.update(jobId, { status: 'running', phase });
    await this.deps.clock.wait(waitMs, signal);
  }

  /** At most MAX_LLM_CALLS_PER_PLAN calls: the initial draft plus one repair. */
  private async draftWithRepair(input: EditorialInput, scenario: MockScenario, signal: AbortSignal): Promise<PlanDraft> {
    for (let attempt = 1; attempt <= this.deps.config.limits.maxLlmCallsPerPlan; attempt += 1) {
      const raw = await this.deps.planner.draft(input, { signal, scenario, attempt });
      const parsed = PlanDraftSchema.safeParse(raw);
      if (parsed.success && hasConsistentIds(parsed.data.candidates)) return parsed.data;
    }
    throw new AppError('PLAN_INVALID');
  }

  private async resolveAll(candidates: readonly Candidate[], scenario: MockScenario, signal: AbortSignal) {
    const playable: ResolvedCandidate[] = [];
    const unavailable: Candidate[] = [];
    const limit = Math.min(candidates.length, this.deps.config.limits.maxCandidatesPerPlan);
    for (let index = 0; index < limit && playable.length < TARGET_SEGMENTS; index += 1) {
      const candidate = candidates[index];
      if (!candidate) break;
      const track = await this.deps.resolver.resolve(candidate, { signal, scenario, index });
      if (track.canAttemptPlayback && track.availability === 'resolved') playable.push({ candidate, track });
      else unavailable.push(candidate);
    }
    return { playable, unavailable };
  }

  private finish(job: JobRecord, plan: ShowPlan): void {
    const current = this.deps.store.get(job.jobId, job.ownerId);
    if (!current || current.status !== 'running') return;
    const count = plan.segments.length;
    this.deps.store.update(job.jobId, {
      status: count >= TARGET_SEGMENTS ? 'completed' : 'partial',
      phase: 'done',
      showId: plan.showId,
      error: count === 0 ? errorEnvelope('NO_RESOLVED_TRACKS', newRequestId()).error : null,
    });
  }

  private fail(jobId: string, signal: AbortSignal, error: unknown): void {
    if (signal.aborted && signal.reason === 'cancel') return;
    const code = signal.aborted && signal.reason === 'timeout' ? 'PLAN_TIMEOUT' : error instanceof AppError ? error.code : 'INTERNAL';
    this.deps.store.update(jobId, { status: 'failed', error: errorEnvelope(code, newRequestId()).error });
  }
}

function hasConsistentIds(candidates: readonly Candidate[]): boolean {
  const ids = new Set(candidates.map((c) => c.candidateId));
  if (ids.size !== candidates.length) return false;
  return candidates.every((c) => !c.transitionBridge || ids.has(c.transitionBridge.fromCandidateId));
}
