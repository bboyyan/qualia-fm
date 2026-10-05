import { describe, expect, it } from 'vitest';
import type { Candidate, Seed } from '@qualia/contracts';
import {
  EXPLORATION_STEP_PER_RUN,
  drawOrder,
  effectiveExploration,
  seedKey,
  trackKey,
  weightedOrder,
} from '../src/services/candidatePool.js';
import { RecentPicks } from '../src/stores/recentPicks.js';

const candidate = (n: number, artist = `TEST Artist ${n}`): Candidate => ({
  candidateId: `c${n}`,
  title: `TEST Song ${n}`,
  artist,
  versionHint: null,
  seedBridge: 'TEST bridge',
  transitionBridge: null,
  vibe: ['TEST', 'TEST', 'TEST'],
  djLine: 'TEST line',
  evidenceLevel: 'model_knowledge',
  evidenceRefs: [],
  uncertainty: null,
});
const pool = (size: number): Candidate[] => Array.from({ length: size }, (_, i) => candidate(i + 1));
const ref = (n: number) => ({ title: `TEST Song ${n}`, artist: `TEST Artist ${n}` });
const seed = (text: string): Seed => ({ kind: 'feeling', text, artist: null });

/** 可重現的亂數（mulberry32）。 */
function seeded(start: number): () => number {
  let state = start >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const firstPickCounts = (exploration: number, size: number, rounds: number): number[] => {
  const random = seeded(7);
  const counts = Array.from({ length: size }, () => 0);
  for (let round = 0; round < rounds; round += 1) {
    const [first] = weightedOrder([...Array(size).keys()], exploration, random);
    counts[first!] = (counts[first!] ?? 0) + 1;
  }
  return counts;
};

describe('候選池抽樣（BRA-127）', () => {
  it('曲名／藝人比對忽略大小寫、全半形與多餘空白', () => {
    expect(trackKey({ title: '  Hello   World ', artist: 'ＡＢＣ' })).toBe(trackKey({ title: 'hello world', artist: 'abc' }));
  });

  it('種子 key 依種類、文字、藝人區分', () => {
    expect(seedKey(seed('深夜'))).toBe(seedKey(seed(' 深夜 ')));
    expect(seedKey(seed('深夜'))).not.toBe(seedKey({ kind: 'song', text: '深夜', artist: null }));
  });

  it('探索度 0 照模型原順序', () => {
    expect(drawOrder(pool(12), { recentRuns: [], exploration: 0, random: seeded(1) }).map((e) => e.index)).toEqual([...Array(12).keys()]);
  });

  it('抽樣只重排、不丟歌：12 首進 12 首出', () => {
    const order = drawOrder(pool(12), { recentRuns: [], exploration: 0.5, random: seeded(3) });
    expect(order.map((e) => e.index).sort((a, b) => a - b)).toEqual([...Array(12).keys()]);
  });

  it('探索度 1 時每首當第一首的機會接近均勻', () => {
    const counts = firstPickCounts(1, 12, 6000);
    for (const count of counts) expect(count / 6000).toBeGreaterThan(0.06);
  });

  it('探索度 0.5 時名次越前越常先抽到，但後段也抽得到', () => {
    const counts = firstPickCounts(0.5, 12, 6000);
    expect(counts[0]!).toBeGreaterThan(counts[11]! * 3);
    expect(counts[11]!).toBeGreaterThan(0);
  });

  it('同種子近期已選的排到最後，只當備援；越早那輪的越先回來，同輪照模型順序', () => {
    // 各輪新到舊：最新一輪選了 Song 2，較早一輪選了 Song 3、5。
    const recentRuns = [[ref(2)], [ref(5), ref(3)]];
    const order = drawOrder(pool(6), { recentRuns, exploration: 0, random: seeded(1) });
    expect(order.map((e) => e.candidate.title)).toEqual(['TEST Song 1', 'TEST Song 4', 'TEST Song 6', 'TEST Song 3', 'TEST Song 5', 'TEST Song 2']);
  });

  it('模型重複提名同一首只留第一次', () => {
    const duplicated = [candidate(1), { ...candidate(1), candidateId: 'c9', title: 'test song 1' }, candidate(2)];
    expect(drawOrder(duplicated, { recentRuns: [], exploration: 0, random: seeded(1) }).map((e) => e.index)).toEqual([0, 2]);
  });

  it('同種子每多一輪紀錄探索度就提高，最多到 1；基準 0＝關閉抽樣', () => {
    expect(effectiveExploration(0.5, 0)).toBe(0.5);
    expect(effectiveExploration(0.5, 2)).toBeCloseTo(0.5 + 2 * EXPLORATION_STEP_PER_RUN);
    expect(effectiveExploration(0.9, 3)).toBe(1);
    expect(effectiveExploration(0, 3)).toBe(0);
  });
});

describe('同種子近期已選紀錄（BRA-127）', () => {
  it('只記最近 N 輪，新到舊攤平', () => {
    const picks = new RecentPicks(2);
    picks.record('owner', seed('深夜'), [ref(1)]);
    picks.record('owner', seed('深夜'), [ref(2)]);
    picks.record('owner', seed('深夜'), [ref(3)]);
    expect(picks.recent('owner', seed('深夜'))).toEqual({ history: [[ref(3)], [ref(2)]], tracks: [ref(3), ref(2)], runs: 2 });
  });

  it('不同種子、不同擁有者互不影響', () => {
    const picks = new RecentPicks(3);
    picks.record('owner', seed('深夜'), [ref(1)]);
    expect(picks.recent('owner', seed('清晨')).runs).toBe(0);
    expect(picks.recent('other', seed('深夜')).runs).toBe(0);
  });

  it('N=0 時停用排除', () => {
    const picks = new RecentPicks(0);
    picks.record('owner', seed('深夜'), [ref(1)]);
    expect(picks.recent('owner', seed('深夜')).tracks).toEqual([]);
  });

  it('登出後忘記該擁有者的紀錄', () => {
    const picks = new RecentPicks(3);
    picks.record('owner', seed('深夜'), [ref(1)]);
    picks.forget('owner');
    expect(picks.recent('owner', seed('深夜')).runs).toBe(0);
  });
});
