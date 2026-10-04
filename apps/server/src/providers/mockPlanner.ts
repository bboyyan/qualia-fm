/**
 * Mock EditorialPlanner. Deterministic, no network, no model. It only sees EditorialInput and
 * says plainly that it has not analysed any music (AC09: no invented BPM/timbre facts).
 */
import { countGraphemes, type Candidate, type SonicDNA } from '@qualia/contracts';
import type { EditorialInput } from '../services/editorialInput.js';
import type { EditorialPlanner, PlannerContext } from './types.js';
import { BASE_POOL, MOCK_ARTIST, TUNE_POOL, type MockEntry } from './mockFixtures.js';

const MOCK_UNCERTAINTY = 'MOCK 虛構曲目：沒有真實音源，不能作為音樂推薦或聲學事實。';
const MAX_EXCERPT = 24;

function excerpt(text: string): string {
  const graphemes = [...new Intl.Segmenter('zh-TW', { granularity: 'grapheme' }).segment(text.trim())].map(
    (s) => s.segment,
  );
  const head = graphemes.slice(0, MAX_EXCERPT).join('');
  return graphemes.length > MAX_EXCERPT ? `${head}…` : head;
}

function analysisFor(input: EditorialInput): SonicDNA {
  const from =
    input.seedKind === 'song'
      ? `以你提供的歌名「${excerpt(input.seedText)}」${input.seedArtist ? `（${excerpt(input.seedArtist)}）` : '（未提供藝人）'}為起點；MOCK 不認識任何歌曲`
      : `從「${excerpt(input.seedText)}」出發`;
  return {
    hookOfFeeling: `MOCK 示意：${from}——有溫度的低頻，放鬆但不完全靜止。`,
    spatialSignature: '依你的描述設想：貼近、留有空間',
    emotionalVelocity: '放鬆但不完全靜止（不是 BPM）',
    timbralPalette: ['柔和低頻', '輕薄聲景'],
    lyricalContext: null,
    basis: 'user_description',
    caveat: '以下全為 MOCK 示意，沒有分析任何真實音樂或音訊。',
  };
}

function toCandidate(entry: MockEntry, index: number, input: EditorialInput, prefix: string): Candidate {
  const previousId = index > 0 ? `c${index}` : null;
  const djLine = input.djLength === 'standard' ? entry.djStandard : entry.djShort;
  return {
    candidateId: `c${index + 1}`,
    title: entry.title,
    artist: MOCK_ARTIST,
    versionHint: null,
    seedBridge: `${prefix}${entry.seedBridge}`,
    transitionBridge:
      entry.transition && previousId
        ? { fromCandidateId: previousId, text: entry.transition.text, djLine: entry.transition.djLine }
        : null,
    vibe: [...entry.vibe],
    djLine,
    evidenceLevel: 'unknown',
    evidenceRefs: [],
    uncertainty: MOCK_UNCERTAINTY,
  };
}

function candidatesFor(input: EditorialInput): Candidate[] {
  if (input.tuning === null) return BASE_POOL.map((e, i) => toCandidate(e, i, input, ''));
  const prefix = `依你的微調「${excerpt(input.tuning)}」：`;
  return TUNE_POOL.map((e, i) => toCandidate(e, i, input, prefix));
}

export class MockEditorialPlanner implements EditorialPlanner {
  async draft(input: EditorialInput, context: PlannerContext): Promise<unknown> {
    if (context.signal.aborted) throw context.signal.reason;
    if (context.scenario === 'error') {
      // Simulates a schema-invalid model response so the repair/budget path is exercised.
      return { schemaVersion: 1, analysis: analysisFor(input), candidates: [], warnings: [] };
    }
    const candidates = candidatesFor(input);
    for (const c of candidates) {
      if (countGraphemes(c.djLine) > 80) throw new Error('mock fixture DJ line exceeds 80 graphemes');
    }
    return {
      schemaVersion: 1,
      analysis: analysisFor(input),
      candidates,
      warnings: ['所有歌名、藝人與聲景皆為 MOCK 虛構資料，不連結真實作品。'],
    };
  }
}
