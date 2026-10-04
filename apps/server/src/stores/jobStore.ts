/**
 * In-memory job / show repository scoped by owner (session id). Records are replaced, never
 * mutated in place. Single-process only: nothing survives a restart (docs/04).
 */
import type { ErrorInfo, JobInfo, JobPhase, JobStatus, ShowPlan } from '@qualia/contracts';

export interface JobRecord {
  readonly jobId: string;
  readonly generationId: string;
  readonly ownerId: string;
  readonly status: JobStatus;
  readonly phase: JobPhase;
  readonly showId: string | null;
  readonly error: ErrorInfo | null;
  readonly payloadHash: string;
  readonly idempotencyKey: string;
  readonly controller: AbortController;
  readonly createdAt: number;
}

const RETENTION_MS = 60 * 60 * 1000;
const MAX_JOBS = 2_000;

export function toJobInfo(job: JobRecord): JobInfo {
  return {
    jobId: job.jobId,
    generationId: job.generationId,
    status: job.status,
    phase: job.phase,
    showId: job.showId,
    error: job.error,
  };
}

export class JobStore {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly idempotency = new Map<string, string>();
  private readonly shows = new Map<string, { ownerId: string; plan: ShowPlan; createdAt: number }>();

  add(job: JobRecord): void {
    this.prune(job.createdAt);
    this.jobs.set(job.jobId, job);
    this.idempotency.set(`${job.ownerId}:${job.idempotencyKey}`, job.jobId);
  }

  /** Owner-checked lookup: another session's job is indistinguishable from a missing one. */
  get(jobId: string, ownerId: string): JobRecord | undefined {
    const job = this.jobs.get(jobId);
    return job && job.ownerId === ownerId ? job : undefined;
  }

  byIdempotencyKey(ownerId: string, key: string): JobRecord | undefined {
    const jobId = this.idempotency.get(`${ownerId}:${key}`);
    return jobId ? this.get(jobId, ownerId) : undefined;
  }

  update(jobId: string, patch: Partial<Pick<JobRecord, 'status' | 'phase' | 'showId' | 'error'>>): JobRecord | undefined {
    const current = this.jobs.get(jobId);
    if (!current) return undefined;
    const next = { ...current, ...patch };
    this.jobs.set(jobId, next);
    return next;
  }

  activeCount(ownerId: string): number {
    let n = 0;
    for (const job of this.jobs.values()) {
      if (job.ownerId === ownerId && (job.status === 'queued' || job.status === 'running')) n += 1;
    }
    return n;
  }

  ownedBy(ownerId: string): JobRecord[] {
    return [...this.jobs.values()].filter((j) => j.ownerId === ownerId);
  }

  putShow(ownerId: string, plan: ShowPlan, now: number): void {
    this.shows.set(plan.showId, { ownerId, plan, createdAt: now });
  }

  getShow(showId: string, ownerId: string): ShowPlan | undefined {
    const entry = this.shows.get(showId);
    return entry && entry.ownerId === ownerId ? entry.plan : undefined;
  }

  forgetOwner(ownerId: string): void {
    for (const [id, job] of this.jobs) if (job.ownerId === ownerId) this.jobs.delete(id);
    for (const [id, show] of this.shows) if (show.ownerId === ownerId) this.shows.delete(id);
    for (const key of this.idempotency.keys()) if (key.startsWith(`${ownerId}:`)) this.idempotency.delete(key);
  }

  private prune(now: number): void {
    for (const [id, job] of this.jobs) {
      if (now - job.createdAt > RETENTION_MS || this.jobs.size > MAX_JOBS) this.jobs.delete(id);
    }
    for (const [id, show] of this.shows) if (now - show.createdAt > RETENTION_MS) this.shows.delete(id);
  }
}
