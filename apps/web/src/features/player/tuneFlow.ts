/**
 * Tail-tune transaction (docs/06 尾段微調的交易). The current track keeps playing; the old tail
 * stays until a valid replacement exists; the commit re-checks session and queue revision so a
 * stale result can never overwrite a newer queue. Cancel leaves everything unchanged.
 */
import type { PlanRequest, ShowPlan } from '@qualia/contracts';
import type { PlaybackEngine } from '../../audio/engine';
import type { Rejection } from '../../audio/types';

export interface TuneContext {
  readonly sessionId: string;
  readonly revision: number;
}

/** Context captured when the user taps 套用; consumed once by the commit hook in App. */
export const pendingTune: { current: TuneContext | null } = { current: null };

export type TuneOutcome =
  | { kind: 'committed'; count: number }
  | { kind: 'empty' }
  | { kind: 'stale_revision' }
  | { kind: 'stale_session' };

export function tuneRequest(show: ShowPlan, tuning: string, dj: PlanRequest['dj']): PlanRequest {
  return { seed: show.seed, requestedCount: 5, dj, tuning: tuning.trim() };
}

export function captureTuneContext(engine: PlaybackEngine): TuneContext | null {
  const state = engine.getState();
  return state.sessionId ? { sessionId: state.sessionId, revision: state.queueRevision } : null;
}

function fromRejection(rejected: Rejection | undefined, count: number): TuneOutcome {
  if (rejected === 'stale_revision') return { kind: 'stale_revision' };
  if (rejected) return { kind: 'stale_session' };
  return { kind: 'committed', count };
}

/** Commits the new tail against the captured context; an empty result keeps the old tail. */
export function commitTune(engine: PlaybackEngine, show: ShowPlan, context: TuneContext): TuneOutcome {
  if (show.segments.length === 0) return { kind: 'empty' };
  return fromRejection(engine.commitTail(show, context.sessionId, context.revision).rejected, show.segments.length);
}

/** Explicit user confirmation after a revision conflict: re-check against the latest revision. */
export function commitTuneAnyway(engine: PlaybackEngine, show: ShowPlan, sessionId: string): TuneOutcome {
  const latest = engine.getState().queueRevision;
  return fromRejection(engine.commitTail(show, sessionId, latest).rejected, show.segments.length);
}
