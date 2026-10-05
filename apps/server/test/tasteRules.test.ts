import { describe, expect, it } from 'vitest';
import { CandidateSchema, trackKeyOf, type Candidate, type TrackMark } from '@qualia/contracts';
import type { TasteSnapshot } from '../src/ledger/tasteStore.js';
import {
  MAX_PINNED_PER_SHOW,
  RECENT_AIRED_WINDOW,
  applyTasteRules,
  tasteHintsFor,
} from '../src/services/tasteRules.js';

const ARTIST = 'TEST Artist';
const key = (title: string): string => trackKeyOf(ARTIST, title);
const at = (minute: number): string => new Date(Date.UTC(2026, 9, 5, 12, minute)).toISOString();

function candidate(title: string, index: number): Candidate {
  return {
    candidateId: `c${index + 1}`, title, artist: ARTIST, versionHint: null, seedBridge: 'TEST bridge',
    transitionBridge: null, vibe: ['TEST', 'TEST', 'TEST'], djLine: 'TEST line', evidenceLevel: 'unknown', evidenceRefs: [], uncertainty: null,
  };
}
const draft = (...titles: string[]): Candidate[] => titles.map(candidate);
const titles = (list: readonly Candidate[]): string[] => list.map((c) => c.title);

function markOf(title: string, patch: Partial<TrackMark>): TrackMark {
  return { trackKey: key(title), title, artist: ARTIST, mark: null, rating: null, note: null, lastAiredAt: null, updatedAt: at(0), ...patch };
}
const snapshot = (marks: TrackMark[] = [], recentTitles: string[] = []): TasteSnapshot => ({ marks, recentAired: recentTitles.map(key) });
const SEVEN = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

describe('V2 開台前選歌管線：blocked → 近 N → pinned → 愛／不對', () => {
  it('沒有任何帳本資料時維持草稿原順序', () => {
    const outcome = applyTasteRules(draft(...SEVEN), snapshot(), { target: 5 });
    expect(titles(outcome.candidates)).toEqual(SEVEN);
    expect(outcome.warnings).toEqual([]);
  });

  it('blocked 硬排除：即使標了「愛」或候選不足也不放回，並明示', () => {
    const outcome = applyTasteRules(draft('A', 'B', 'C'), snapshot([markOf('B', { mark: 'blocked', rating: '愛' })]), { target: 5 });
    expect(titles(outcome.candidates)).toEqual(['A', 'C']);
    expect(outcome.trace.blocked).toEqual([key('B')]);
    expect(outcome.warnings).toEqual(['已排除 1 首你封鎖的歌，本輪候選不足 5 首。']);
  });

  it('近 N 已播排除：候選足夠時直接拿掉', () => {
    const outcome = applyTasteRules(draft(...SEVEN), snapshot([], ['B', 'D']), { target: 5 });
    expect(titles(outcome.candidates)).toEqual(['A', 'C', 'E', 'F', 'G']);
    expect(outcome.trace.recent).toEqual([key('B'), key('D')]);
    expect(outcome.warnings).toEqual([]);
  });

  it(`近 N 只看最近 ${RECENT_AIRED_WINDOW} 首；更早播過的可以再排`, () => {
    const recent = Array.from({ length: RECENT_AIRED_WINDOW }, (_, i) => `R${i}`);
    const outcome = applyTasteRules(draft('A', 'R0', 'old'), snapshot([], [...recent, 'old']), { target: 1 });
    expect(titles(outcome.candidates)).toEqual(['A', 'old']);
  });

  it('降級：近 N 擋到不足目標首數時，依「最久以前播」放回並明示（不靜默）', () => {
    const outcome = applyTasteRules(draft('A', 'B', 'C', 'D', 'E', 'F'), snapshot([], ['C', 'D', 'E', 'F']), { target: 5 });
    expect(titles(outcome.candidates)).toEqual(['A', 'B', 'F', 'E', 'D']);
    expect(outcome.trace.readmitted).toEqual([key('F'), key('E'), key('D')]);
    expect(outcome.warnings).toEqual([`近期已播的歌不夠避開：本輪重播 3 首最近 ${RECENT_AIRED_WINDOW} 首內播過的歌。`]);
  });

  it('blocked 先於近 N：已封鎖又剛播過的歌記在 blocked，不會被當成近期已播放回', () => {
    const outcome = applyTasteRules(draft('A', 'B'), snapshot([markOf('B', { mark: 'blocked' })], ['B']), { target: 5 });
    expect(outcome.trace.blocked).toEqual([key('B')]);
    expect(outcome.trace.recent).toEqual([]);
    expect(outcome.trace.readmitted).toEqual([]);
    expect(titles(outcome.candidates)).toEqual(['A']);
  });

  it('pinned 置前，且不受近 N 限制（近 N 在前、pinned 在後）', () => {
    const outcome = applyTasteRules(draft(...SEVEN), snapshot([markOf('E', { mark: 'pinned' })], ['E']), { target: 5 });
    expect(titles(outcome.candidates)).toEqual(['E', 'A', 'B', 'C', 'D', 'F', 'G']);
    expect(outcome.trace.pinned).toEqual([key('E')]);
  });

  it(`pinned 上限 ${MAX_PINNED_PER_SHOW} 首：最久沒播（從未播最優先）的先排`, () => {
    const marks = [
      markOf('P1', { mark: 'pinned', lastAiredAt: at(30) }),
      markOf('P2', { mark: 'pinned', lastAiredAt: null }),
      markOf('P3', { mark: 'pinned', lastAiredAt: at(10) }),
    ];
    const outcome = applyTasteRules(draft('A', 'B', 'C', 'D', 'E'), snapshot(marks), { target: 5 });
    expect(MAX_PINNED_PER_SHOW).toBe(2);
    expect(outcome.trace.pinned).toEqual([key('P2'), key('P3')]);
    expect(titles(outcome.candidates)).toEqual(['P2', 'P3', 'A', 'B', 'C', 'D', 'E']);
  });

  it('草稿裡沒有的 pinned 會補成合法候選（不撞 candidateId、沒有 transition）', () => {
    const outcome = applyTasteRules(draft('A', 'B'), snapshot([markOf('Pinned Song', { mark: 'pinned' })]), { target: 5 });
    const [pinned] = outcome.candidates;
    expect(CandidateSchema.parse(pinned)).toMatchObject({ title: 'Pinned Song', artist: ARTIST, transitionBridge: null, evidenceLevel: 'user_description' });
    expect(new Set(outcome.candidates.map((c) => c.candidateId)).size).toBe(outcome.candidates.length);
  });

  it('草稿裡已有的 pinned 用草稿那份，只移到最前', () => {
    const outcome = applyTasteRules(draft('A', 'B', 'C'), snapshot([markOf('C', { mark: 'pinned' })]), { target: 3 });
    expect(outcome.candidates[0]).toEqual(candidate('C', 2));
    expect(titles(outcome.candidates)).toEqual(['C', 'A', 'B']);
  });

  it('pinned 上限設 0 時不排釘選', () => {
    const outcome = applyTasteRules(draft('A'), snapshot([markOf('P', { mark: 'pinned' })]), { target: 1, maxPinned: 0 });
    expect(titles(outcome.candidates)).toEqual(['A']);
  });

  it('「愛」輕推往前、「不對」降權往後但不排除', () => {
    const marks = [markOf('D', { rating: '愛' }), markOf('A', { rating: '不對', note: '太吵' })];
    const outcome = applyTasteRules(draft(...SEVEN), snapshot(marks), { target: 5 });
    expect(titles(outcome.candidates)).toEqual(['B', 'D', 'C', 'A', 'E', 'F', 'G']);
    expect(outcome.trace.loved).toEqual([key('D')]);
    expect(outcome.trace.disliked).toEqual([key('A')]);
  });

  it('完整順序：blocked、近 N、pinned、愛／不對同時存在', () => {
    const marks = [
      markOf('A', { mark: 'blocked' }),
      markOf('G', { mark: 'pinned' }),
      markOf('F', { rating: '愛' }),
      markOf('C', { rating: '不對' }),
    ];
    const outcome = applyTasteRules(draft(...SEVEN), snapshot(marks, ['B', 'G']), { target: 5 });
    expect(outcome.trace).toMatchObject({ blocked: [key('A')], recent: [key('B'), key('G')], pinned: [key('G')], readmitted: [] });
    expect(titles(outcome.candidates)).toEqual(['G', 'D', 'F', 'E', 'C']);
  });
});

describe('tasteHintsFor（planner 軟約束）', () => {
  it('avoid＝封鎖＋近 N；愛／不對附短評；封鎖的歌不列入愛／不對', () => {
    const marks = [
      markOf('A', { mark: 'blocked', rating: '不對', note: 'TEST 封鎖' }),
      markOf('B', { rating: '愛', note: '低頻很暖', updatedAt: at(2) }),
      markOf('C', { rating: '不對', note: '太吵', updatedAt: at(3) }),
      markOf('D', { lastAiredAt: at(4) }),
    ];
    expect(tasteHintsFor(snapshot(marks, ['D']))).toEqual({
      avoid: [{ title: 'A', artist: ARTIST }, { title: 'D', artist: ARTIST }],
      loved: [{ title: 'B', artist: ARTIST, note: '低頻很暖' }],
      disliked: [{ title: 'C', artist: ARTIST, note: '太吵' }],
    });
  });
});
