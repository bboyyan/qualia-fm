/**
 * In-memory job / show repository scoped by owner (session id). Records are replaced, never
 * mutated in place. Single-process only: nothing survives a restart (docs/04).
 */
import type { FeedbackReceipt, ErrorInfo, JobInfo, JobPhase, JobStatus, ShowPlan } from '@qualia/contracts';

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
  readonly lastAccess: number;
}

const RETENTION_MS = 24 * 60 * 60 * 1000;
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
  private readonly shows = new Map<string, { ownerId: string; plan: ShowPlan; lastAccess: number; feedback: Map<string, Promise<FeedbackReceipt>> }>();

  constructor(private readonly now: () => number = Date.now, private readonly retentionMs = RETENTION_MS) {}

  add(job: JobRecord): void {
    this.prune(job.createdAt);
    this.jobs.set(job.jobId, job);
    this.idempotency.set(`${job.ownerId}:${job.idempotencyKey}`, job.jobId);
  }

  /** Owner-checked lookup: another session's job is indistinguishable from a missing one. */
  get(jobId: string, ownerId: string): JobRecord | undefined {
    const job = this.jobs.get(jobId);
    if (!job || job.ownerId !== ownerId) return undefined;
    const touched = { ...job, lastAccess: this.now() };
    this.jobs.set(jobId, touched);
    if (job.showId) this.getShow(job.showId, ownerId);
    return touched;
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
    this.shows.set(plan.showId, { ownerId, plan, lastAccess: now, feedback: new Map() });
  }

  getShow(showId: string, ownerId: string): ShowPlan | undefined {
    const entry = this.shows.get(showId);
    if (!entry || entry.ownerId !== ownerId) return undefined;
    this.shows.set(showId, { ...entry, lastAccess: this.now() });
    return entry.plan;
  }

  /** 先保留進行中的寫入，並行重送共用收據；失敗才釋放 key 供重試。 */
  saveFeedback(showId: string, ownerId: string, key: string, save: () => Promise<FeedbackReceipt>): Promise<FeedbackReceipt> {
    const entry = this.shows.get(showId);
    if (!entry || entry.ownerId !== ownerId) throw new Error('feedback requires an owned show');
    const existing = entry.feedback.get(key);
    if (existing) return existing;
    const pending = Promise.resolve().then(save).catch((error: unknown) => {
      entry.feedback.delete(key);
      throw error;
    });
    entry.feedback.set(key, pending);
    return pending;
  }

  ownedShows(ownerId: string): ShowPlan[] {
    return [...this.shows.values()].filter((entry) => entry.ownerId === ownerId).map((entry) => entry.plan);
  }

  /** 中斷 Spotify 連結：把所有節目裡 Spotify 回傳的欄位換掉（ID、封面、正式名稱、外連、URI），段落與回饋保留。 */
  scrubSpotify(): void {
    for (const [id, entry] of this.shows) {
      if (!entry.plan.segments.some((segment) => segment.track.provider === 'spotify')) continue;
      const segments = entry.plan.segments.map((segment) => segment.track.provider !== 'spotify' ? segment : {
        ...segment,
        track: {
          provider: 'spotify' as const,
          providerTrackId: null,
          canonicalTitle: segment.candidate.title,
          canonicalArtists: [segment.candidate.artist],
          artworkUrl: null,
          durationMs: null,
          externalUrl: null,
          availability: 'unavailable' as const,
          canAttemptPlayback: false,
          audioLocator: { kind: 'none' as const },
        },
      });
      this.shows.set(id, { ...entry, plan: { ...entry.plan, segments } });
    }
  }

  forgetOwner(ownerId: string): void {
    for (const [id, job] of this.jobs) if (job.ownerId === ownerId) this.jobs.delete(id);
    for (const [id, show] of this.shows) if (show.ownerId === ownerId) this.shows.delete(id);
    for (const key of this.idempotency.keys()) if (key.startsWith(`${ownerId}:`)) this.idempotency.delete(key);
  }

  private prune(now: number): void {
    for (const [id, job] of this.jobs) {
      if (now - job.lastAccess > this.retentionMs || this.jobs.size > MAX_JOBS) this.jobs.delete(id);
    }
    for (const [key, jobId] of this.idempotency) if (!this.jobs.has(jobId)) this.idempotency.delete(key);
    for (const [id, show] of this.shows) if (now - show.lastAccess > this.retentionMs) this.shows.delete(id);
  }
}
