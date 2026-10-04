/**
 * Builds the immutable server ShowPlan from validated candidates and resolver output.
 * transitionBridge survives only when its `fromCandidateId` is the actual previous playable
 * segment — dropped or reordered neighbours invalidate it (docs/01 transitionBridge).
 */
import { randomBytes } from 'node:crypto';
import {
  ShowPlanSchema,
  type Candidate,
  type PlanDraft,
  type ResolvedTrack,
  type Seed,
  type Segment,
  type ShowPlan,
  type SpeechLocator,
} from '@qualia/contracts';

export interface ResolvedCandidate {
  readonly candidate: Candidate;
  readonly track: ResolvedTrack;
}

export interface BuildShowInput {
  readonly seed: Seed;
  readonly draft: PlanDraft;
  readonly playable: readonly ResolvedCandidate[];
  readonly unavailable: readonly Candidate[];
  readonly speech: SpeechLocator;
  readonly now: number;
}

const TARGET_SEGMENTS = 5;

function withValidTransition(candidate: Candidate, previous: Candidate | undefined): Candidate {
  const transition = candidate.transitionBridge;
  if (transition && transition.fromCandidateId === previous?.candidateId) return candidate;
  return { ...candidate, transitionBridge: null };
}

function warningsFor(draft: PlanDraft, playableCount: number, unavailableCount: number): string[] {
  const warnings = [...draft.warnings];
  if (playableCount < TARGET_SEGMENTS) {
    warnings.push(
      playableCount === 0
        ? '這次沒有可播放的曲目，保留感覺分析與待確認清單。'
        : `已確認 ${playableCount} 首，${unavailableCount} 首候選暫時無法使用。`,
    );
  }
  return warnings.slice(0, 10);
}

export function buildShowPlan(input: BuildShowInput): ShowPlan {
  const showId = `show_${randomBytes(6).toString('hex')}`;
  const chosen = input.playable.slice(0, TARGET_SEGMENTS);
  const segments: Segment[] = chosen.map((entry, i) => ({
    segmentId: `${showId}_${i + 1}`,
    candidate: withValidTransition(entry.candidate, chosen[i - 1]?.candidate),
    track: entry.track,
    speech: input.speech,
  }));
  const plan: ShowPlan = {
    schemaVersion: 1,
    showId,
    createdAt: new Date(input.now).toISOString(),
    seed: input.seed,
    analysis: input.draft.analysis,
    segments,
    unavailable: input.unavailable.map((c) => ({ ...c, transitionBridge: null })).slice(0, 10),
    warnings: warningsFor(input.draft, segments.length, input.unavailable.length),
    isDemo: true,
  };
  return ShowPlanSchema.parse(plan);
}
