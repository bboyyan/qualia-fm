/**
 * BRA-127 選歌多樣化：模型提名 8–12 首成為候選池 → 排除同種子近幾輪已選 → 依探索參數加權抽樣排序 →
 * PlanService 照這個順序逐首對應，不可播就往下補抽，直到 5 首可播或池子用完。
 * 全是純函式；亂數由呼叫端注入，測試可重現。
 */
import type { Candidate, Seed } from '@qualia/contracts';

/** 對模型要的候選池大小；實際收到少於下限時照用（不捏造湊數）。 */
export const POOL_MIN = 8;
export const POOL_MAX = 12;
/** 同種子每多一輪近期紀錄，探索度提高這麼多（「重新選歌」越按越往外走）。 */
export const EXPLORATION_STEP_PER_RUN = 0.15;
/** 探索度 0 時名次權重的衰減指數；探索度 1 時為 0（均勻抽樣）。 */
const MAX_RANK_SHARPNESS = 2;

export interface TrackRef {
  readonly title: string;
  readonly artist: string;
}

export interface PoolEntry {
  readonly candidate: Candidate;
  /** 在模型草稿裡的原始位置；節目順序與 transitionBridge 都以它為準。 */
  readonly index: number;
}

export interface DrawOptions {
  /** 同種子近期各輪已選（新到舊，一輪一組）。 */
  readonly recentRuns: readonly (readonly TrackRef[])[];
  /** 0＝照模型排序不抽樣；1＝均勻抽樣。 */
  readonly exploration: number;
  readonly random: () => number;
}

const normalize = (text: string): string => text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

export const trackKey = (track: TrackRef): string => `${normalize(track.title)}\u0000${normalize(track.artist)}`;

export const seedKey = (seed: Seed): string => [seed.kind, normalize(seed.text), normalize(seed.artist ?? '')].join('\u0000');

export const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

/** 基準探索度 0 代表營運端關閉抽樣，重開幾輪都維持模型排序。 */
export function effectiveExploration(base: number, recentRuns: number): number {
  if (base <= 0) return 0;
  return clampUnit(base + EXPLORATION_STEP_PER_RUN * recentRuns);
}

/**
 * Efraimidis–Spirakis 加權不放回抽樣：權重 1/(名次+1)^α，α 隨探索度從 2 降到 0。
 * 名次越前越容易先被抽到，但每首都有機會；探索度 0 時直接回傳原順序。
 */
export function weightedOrder<T>(items: readonly T[], exploration: number, random: () => number): T[] {
  const level = clampUnit(exploration);
  if (level === 0) return [...items];
  const alpha = MAX_RANK_SHARPNESS * (1 - level);
  return items
    .map((item, rank) => {
      const weight = (rank + 1) ** -alpha;
      const u = Math.max(Number.EPSILON, random());
      return { item, key: Math.log(u) / weight };
    })
    .sort((a, b) => b.key - a.key)
    .map((entry) => entry.item);
}

/**
 * 抽樣順序：同一首重複提名只留第一次；未在近期出現過的先（加權抽樣），
 * 近期已選的只在新曲不夠時當最後備援：越早那輪的越先回來，同一輪內照模型順序。
 */
export function drawOrder(candidates: readonly Candidate[], options: DrawOptions): PoolEntry[] {
  /** trackKey → 最近一次被選的輪次（0＝最新）。 */
  const recency = new Map<string, number>();
  options.recentRuns.forEach((run, age) => {
    for (const track of run) if (!recency.has(trackKey(track))) recency.set(trackKey(track), age);
  });
  const seen = new Set<string>();
  const unique = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => {
      const key = trackKey(candidate);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const fresh = unique.filter(({ candidate }) => !recency.has(trackKey(candidate)));
  const repeats = unique
    .filter(({ candidate }) => recency.has(trackKey(candidate)))
    .sort((a, b) => (recency.get(trackKey(b.candidate)) ?? 0) - (recency.get(trackKey(a.candidate)) ?? 0));
  return [...weightedOrder(fresh, options.exploration, options.random), ...repeats];
}
