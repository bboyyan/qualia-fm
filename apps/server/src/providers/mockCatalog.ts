/**
 * Mock CatalogResolver. Resolved entries carry a `mock_tone` locator: the client synthesises a
 * clearly labelled test tone — never real music, never a proxied third-party stream.
 */
import type { Candidate, MockScenario, ResolvedTrack } from '@qualia/contracts';
import type { CatalogResolver, ResolverContext } from './types.js';

/** Candidate indexes reported unavailable per scenario (exercises partial results). */
const PLAYABLE_IN_THREE: ReadonlySet<number> = new Set([0, 2, 4]);
const UNAVAILABLE: Record<MockScenario, (index: number) => boolean> = {
  five: () => false,
  slow: () => false,
  error: () => false,
  // 候選池再大也只有 3 首可播：補抽到底仍不足 5 首（BRA-127）。
  three: (index) => !PLAYABLE_IN_THREE.has(index),
  zero: () => true,
};

export class MockCatalogResolver implements CatalogResolver {
  constructor(private readonly trackMs: number) {}

  async resolve(candidate: Candidate, context: ResolverContext): Promise<ResolvedTrack> {
    if (context.signal.aborted) throw context.signal.reason;
    const base = {
      provider: 'mock' as const,
      providerTrackId: null,
      canonicalTitle: candidate.title,
      canonicalArtists: [candidate.artist],
      artworkUrl: null,
      externalUrl: null,
    };
    if (UNAVAILABLE[context.scenario](context.index)) {
      return {
        ...base,
        durationMs: null,
        availability: 'unavailable',
        canAttemptPlayback: false,
        audioLocator: { kind: 'none' },
      };
    }
    return {
      ...base,
      durationMs: this.trackMs,
      availability: 'resolved',
      canAttemptPlayback: true,
      audioLocator: { kind: 'mock_tone', palette: context.index % 8, durationMs: this.trackMs },
    };
  }
}
