/**
 * Mock CatalogResolver. Resolved entries carry a `mock_tone` locator: the client synthesises a
 * clearly labelled test tone — never real music, never a proxied third-party stream.
 */
import type { Candidate, MockScenario, ResolvedTrack } from '@qualia/contracts';
import type { CatalogResolver, ResolverContext } from './types.js';

/** Candidate indexes reported unavailable per scenario (exercises partial results). */
const UNAVAILABLE: Record<MockScenario, ReadonlySet<number>> = {
  five: new Set(),
  slow: new Set(),
  error: new Set(),
  three: new Set([1, 3, 5, 6]),
  zero: new Set([0, 1, 2, 3, 4, 5, 6]),
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
    if (UNAVAILABLE[context.scenario].has(context.index)) {
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
