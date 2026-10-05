import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CandidateSchema,
  CapabilitiesSchema,
  DJ_LINE_MAX_GRAPHEMES,
  DJ_SHORT_MAX_GRAPHEMES,
  ErrorEnvelopeSchema,
  PlanRequestSchema,
  SeedSchema,
  countGraphemes,
} from '../src/index.js';

const handoff = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../handoff/examples/${name}`, import.meta.url)), 'utf8'));

describe('countGraphemes', () => {
  it('counts CJK characters, punctuation and spaces as one each', () => {
    expect(countGraphemes('深夜，還不想睡 ok')).toBe(10);
  });

  it('counts a family emoji ZWJ sequence as one grapheme', () => {
    expect(countGraphemes('👨‍👩‍👧')).toBe(1);
  });
});

describe('SeedSchema', () => {
  it('rejects a whitespace-only seed', () => {
    expect(SeedSchema.safeParse({ kind: 'feeling', text: '   ', artist: null }).success).toBe(false);
  });

  it('accepts exactly 500 graphemes and rejects 501', () => {
    const ok = SeedSchema.safeParse({ kind: 'feeling', text: '夜'.repeat(500), artist: null });
    const tooLong = SeedSchema.safeParse({ kind: 'feeling', text: '夜'.repeat(501), artist: null });
    expect([ok.success, tooLong.success]).toEqual([true, false]);
  });

  it('measures 500 emoji by graphemes, not UTF-16 length', () => {
    const text = '🌙'.repeat(500);
    expect(SeedSchema.safeParse({ kind: 'sound', text, artist: null }).success).toBe(true);
  });
});

describe('DJ 台詞長度（BRA-117 加厚引言）', () => {
  const candidate = (djLine: string) => ({
    candidateId: 'c1', title: 'TEST', artist: 'TEST', versionHint: null, seedBridge: 'TEST', transitionBridge: null,
    vibe: ['一', '二', '三'], djLine, evidenceLevel: 'unknown', evidenceRefs: [], uncertainty: null,
  });

  it('標準版上限 180、短版 80', () => {
    expect([DJ_LINE_MAX_GRAPHEMES, DJ_SHORT_MAX_GRAPHEMES]).toEqual([180, 80]);
  });

  it('接受剛好 180 grapheme 的引言，拒絕 181', () => {
    expect(CandidateSchema.safeParse(candidate('夜'.repeat(180))).success).toBe(true);
    expect(CandidateSchema.safeParse(candidate('夜'.repeat(181))).success).toBe(false);
  });
});

describe('handoff fixtures stay compatible', () => {
  it('parses examples/plan-request.json', () => {
    expect(PlanRequestSchema.safeParse(handoff('plan-request.json')).success).toBe(true);
  });

  it('parses examples/capabilities.demo.json', () => {
    expect(CapabilitiesSchema.safeParse(handoff('capabilities.demo.json')).success).toBe(true);
  });

  it('rejects extra fields on a plan request (no client-side gate overrides)', () => {
    const request = { ...(handoff('plan-request.json') as object), spotifyEnabled: true };
    expect(PlanRequestSchema.safeParse(request).success).toBe(false);
  });

  it('parses the documented ErrorEnvelope example', () => {
    const envelope = {
      error: {
        code: 'AUTOPLAY_BLOCKED',
        message: '手機需要一次點擊才能繼續播放。',
        retryable: true,
        requestId: 'req_demo',
        retryAfterMs: null,
      },
    };
    expect(ErrorEnvelopeSchema.safeParse(envelope).success).toBe(true);
  });
});
