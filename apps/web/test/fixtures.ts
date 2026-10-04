import type { Candidate, Segment, ShowPlan } from '@qualia/contracts';

export function candidate(n: number, transitionFrom: number | null = null): Candidate {
  return {
    candidateId: `c${n}`,
    title: `曲目${n}`,
    artist: 'Qualia Mock · 虛構藝人',
    versionHint: null,
    seedBridge: `seed bridge ${n}`,
    transitionBridge: transitionFrom ? { fromCandidateId: `c${transitionFrom}`, text: `transition ${transitionFrom}→${n}`, djLine: `接續 ${n}` } : null,
    vibe: ['溫暖', '留白', '夜行'],
    djLine: `介紹 ${n}`,
    evidenceLevel: 'unknown',
    evidenceRefs: [],
    uncertainty: null,
  };
}

export function segment(showId: string, n: number, options: { transitionFrom?: number; speech?: boolean; durationMs?: number } = {}): Segment {
  const durationMs = options.durationMs ?? 30_000;
  return {
    segmentId: `${showId}_${n}`,
    candidate: candidate(n, options.transitionFrom ?? null),
    track: {
      provider: 'mock',
      providerTrackId: null,
      canonicalTitle: `曲目${n}`,
      canonicalArtists: ['Qualia Mock · 虛構藝人'],
      artworkUrl: null,
      durationMs,
      externalUrl: null,
      availability: 'resolved',
      canAttemptPlayback: true,
      audioLocator: { kind: 'mock_tone', palette: n % 8, durationMs },
    },
    speech: options.speech === false ? { kind: 'none' } : { kind: 'mock_chime', durationMs: 2_000 },
  };
}

/** Five segments; 2←1, 3←2, 4←3 carry transition bridges (mirrors the server mock pool). */
export function makeShow(showId = 'showA', count = 5, speech = true): ShowPlan {
  return {
    schemaVersion: 1,
    showId,
    createdAt: '2026-10-04T00:00:00.000Z',
    seed: { kind: 'feeling', text: '深夜', artist: null },
    analysis: {
      hookOfFeeling: 'hook',
      spatialSignature: null,
      emotionalVelocity: null,
      timbralPalette: [],
      lyricalContext: null,
      basis: 'user_description',
      caveat: null,
    },
    segments: Array.from({ length: count }, (_, i) =>
      segment(showId, i + 1, { transitionFrom: i >= 1 && i <= 3 ? i : undefined, speech }),
    ),
    unavailable: [],
    warnings: [],
    isDemo: true,
  };
}
