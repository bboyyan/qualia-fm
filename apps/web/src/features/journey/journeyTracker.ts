/**
 * 把播放引擎與回饋接到寶石模型：新節目（新 session）＝種子寶石；曲目狀態變成 played＝鑲嵌；
 * 回饋送出＝鑲嵌（或把評價補到既有寶石）。同一狀態重複觀察不會通知訂閱者。
 */
import type { FeedbackRating } from '@qualia/contracts';
import type { EngineState, QueueItem } from '../../audio/types';
import { EMPTY_JOURNEY, addSeedGem, inlayTrack, markCapsuleOpened, type Capsule, type Journey, type TrackInput } from './journey';

function trackOf(sessionId: string, item: QueueItem): TrackInput {
  const { candidate } = item.segment;
  return { key: `${sessionId}:${item.segment.segmentId}`, title: candidate.title, artist: candidate.artist, vibe: candidate.vibe };
}

export class JourneyTracker {
  private journey: Journey = EMPTY_JOURNEY;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly onCapsule?: (capsule: Capsule) => void) {}

  getState = (): Journey => this.journey;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  observe(state: EngineState): void {
    const { sessionId, show } = state;
    if (!sessionId || !show) return;
    let next = addSeedGem(this.journey, { key: `seed:${sessionId}`, seed: show.seed.text });
    for (const item of state.queue) {
      if (state.statuses[item.segment.segmentId] === 'played') next = inlayTrack(next, trackOf(sessionId, item), 'listened');
    }
    this.commit(next);
  }

  recordFeedback(sessionId: string | null, item: QueueItem, rating: FeedbackRating): void {
    if (!sessionId) return;
    this.commit(inlayTrack(this.journey, trackOf(sessionId, item), 'feedback', rating));
  }

  openCapsule(): void {
    this.commit(markCapsuleOpened(this.journey));
  }

  private commit(next: Journey): void {
    if (next === this.journey) return;
    const sealed = next.capsuleCount > this.journey.capsuleCount;
    this.journey = next;
    for (const listener of this.listeners) listener();
    if (sealed && next.capsule) this.onCapsule?.(next.capsule);
  }
}
