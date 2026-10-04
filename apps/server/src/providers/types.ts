import type { Candidate, MockScenario, ResolvedTrack } from '@qualia/contracts';
import type { EditorialInput } from '../services/editorialInput.js';

export interface PlannerContext {
  readonly signal: AbortSignal;
  readonly scenario: MockScenario;
  /** 1 for the initial draft, 2 for the single permitted repair attempt. */
  readonly attempt: number;
  /** 整輪預算 gate，失敗時只允許 mock。 */
  readonly realAllowed?: boolean;
}

/**
 * Produces a PlanDraft-shaped object. Output is untrusted: PlanService validates it with
 * PlanDraftSchema before use, exactly as it would a real model response.
 */
export interface EditorialPlanner {
  draft(input: EditorialInput, context: PlannerContext): Promise<unknown>;
}

export interface ResolverContext {
  readonly signal: AbortSignal;
  readonly scenario: MockScenario;
  readonly index: number;
}

/** Resolves identity/availability. Never feeds its results back into the planner. */
export interface CatalogResolver {
  resolve(candidate: Candidate, context: ResolverContext): Promise<ResolvedTrack>;
}

export interface PhaseClock {
  /** Abortable wait used to pace mock phases; resolves early never, rejects on abort. */
  wait(ms: number, signal: AbortSignal): Promise<void>;
}
