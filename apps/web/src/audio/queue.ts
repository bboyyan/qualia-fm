/**
 * Bridge adjacency. A transitionBridge is shown only when its `fromCandidateId` is the actual
 * previous segment from the same show; otherwise the seedBridge is used (docs/01, AC21).
 */
import type { EngineState, QueueItem } from './types';

export interface BridgeView {
  readonly kind: 'transition' | 'seed';
  readonly text: string;
  readonly djLine: string;
  readonly fromTitle: string | null;
}

export function effectiveBridge(item: QueueItem, previous: QueueItem | null): BridgeView {
  const { candidate } = item.segment;
  const transition = candidate.transitionBridge;
  if (
    transition &&
    previous &&
    previous.showId === item.showId &&
    previous.segment.candidate.candidateId === transition.fromCandidateId
  ) {
    return { kind: 'transition', text: transition.text, djLine: transition.djLine, fromTitle: previous.segment.candidate.title };
  }
  return { kind: 'seed', text: candidate.seedBridge, djLine: candidate.djLine, fromTitle: null };
}

/** The segment that actually finished right before the current one, or null if skipped/none. */
export function previousForCurrent(state: EngineState): QueueItem | null {
  if (!state.previousPlayedId) return null;
  const index = state.queue.findIndex((q) => q.segment.segmentId === state.previousPlayedId);
  return index >= 0 && index === state.currentIndex - 1 ? (state.queue[index] ?? null) : null;
}

export function currentItem(state: EngineState): QueueItem | null {
  return state.queue[state.currentIndex] ?? null;
}

export function currentBridge(state: EngineState): BridgeView | null {
  const item = currentItem(state);
  return item ? effectiveBridge(item, previousForCurrent(state)) : null;
}

/**
 * Bridge for a row in the queue sheet. The current row uses what actually happened; future rows
 * assume their queue predecessor will finish naturally.
 */
export function bridgeAt(state: EngineState, index: number): BridgeView | null {
  const item = state.queue[index];
  if (!item) return null;
  if (index === state.currentIndex) return currentBridge(state);
  const previous = index > state.currentIndex ? (state.queue[index - 1] ?? null) : null;
  return effectiveBridge(item, previous);
}

export function nextItem(state: EngineState): QueueItem | null {
  return state.queue[state.currentIndex + 1] ?? null;
}
