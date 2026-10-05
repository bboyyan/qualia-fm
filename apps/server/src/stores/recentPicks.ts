/**
 * BRA-127：每位擁有者、每個種子最近 N 輪節目選進來的曲目（只存 LLM 提名的曲名／藝人，不存 Spotify 回傳欄位）。
 * 純記憶體、有上限；登出／session 結束時隨 forget 清掉。
 */
import type { Seed } from '@qualia/contracts';
import { seedKey, type TrackRef } from '../services/candidatePool.js';

const MAX_SEEDS_PER_OWNER = 50;
const MAX_OWNERS = 200;

export interface RecentSelection {
  /** 近期各輪已選（新到舊，一輪一組）。 */
  readonly history: readonly (readonly TrackRef[])[];
  /** 同上，攤平成一串（給模型看）。 */
  readonly tracks: readonly TrackRef[];
  /** 近期有紀錄的輪數（0..runs）。 */
  readonly runs: number;
}

const EMPTY: RecentSelection = { history: [], tracks: [], runs: 0 };

export class RecentPicks {
  /** ownerId → seedKey → 各輪選曲（新到舊）。Map 依插入順序，刪了再放回即為 LRU。 */
  private readonly byOwner = new Map<string, Map<string, readonly (readonly TrackRef[])[]>>();

  /** @param runs 記住幾輪；0 表示停用排除。 */
  constructor(private readonly runs: number) {}

  recent(ownerId: string, seed: Seed): RecentSelection {
    const history = this.byOwner.get(ownerId)?.get(seedKey(seed));
    if (!history) return EMPTY;
    return { history, tracks: history.flat(), runs: history.length };
  }

  record(ownerId: string, seed: Seed, picks: readonly TrackRef[]): void {
    if (this.runs <= 0 || picks.length === 0) return;
    const seeds = this.byOwner.get(ownerId) ?? new Map<string, readonly (readonly TrackRef[])[]>();
    this.byOwner.delete(ownerId);
    this.byOwner.set(ownerId, seeds);
    const key = seedKey(seed);
    const previous = seeds.get(key) ?? [];
    seeds.delete(key);
    seeds.set(key, [picks.map(({ title, artist }) => ({ title, artist })), ...previous].slice(0, this.runs));
    dropOldest(seeds, MAX_SEEDS_PER_OWNER);
    dropOldest(this.byOwner, MAX_OWNERS);
  }

  forget(ownerId: string): void {
    this.byOwner.delete(ownerId);
  }
}

function dropOldest<K, V>(map: Map<K, V>, max: number): void {
  for (const key of map.keys()) {
    if (map.size <= max) return;
    map.delete(key);
  }
}
