/**
 * 開台前選歌管線（BRA-134）。固定順序，每一步只看上一步的結果：
 *   1. blocked 硬排除（任何情況都不放回）
 *   2. 近 N 已播排除（候選不足時才依「最久以前播」放回，並明示 warning）
 *   3. pinned 置前，每輪最多 MAX_PINNED_PER_SHOW 首（不受近 N 限制；超過上限時最久沒播的優先）
 *   4. 「愛」輕推、「不對」降權（只調順序，不排除）；短評交給 planner 當軟約束（見 tasteHintsFor）
 * 純函式：不讀檔、不呼叫網路；帳本讀不到時由 PlanService 決定降級。
 */
import {
  DJ_SHORT_MAX_GRAPHEMES,
  countGraphemes,
  trackKeyOf,
  type Candidate,
  type TrackMark,
} from '@qualia/contracts';
import type { TasteSnapshot } from '../ledger/tasteStore.js';

/** 近 N 已播：最近播出的 N 首（不重複）不再排進新節目。 */
export const RECENT_AIRED_WINDOW = 10;
/** 每輪最多排入的釘選曲數。 */
export const MAX_PINNED_PER_SHOW = 2;
/** 「愛」往前挪的位置數（輕推，不保證進前 5）。 */
export const LOVE_NUDGE = 1.5;
/** 「不對」往後挪的位置數（降權，不排除）。 */
export const DISLIKE_PENALTY = 4;
/** 給 planner 的提示清單上限，避免帳本變大後撐爆 prompt。 */
export const MAX_HINTS_PER_LIST = 15;
export const MAX_AVOID_HINTS = 40;

export interface TasteRuleOptions {
  /** 節目目標首數（不足時才放回近期已播）。 */
  readonly target: number;
  readonly recentWindow?: number;
  readonly maxPinned?: number;
}

/** 每一步處理到的 trackKey，供測試與除錯核對順序。 */
export interface TasteTrace {
  readonly blocked: readonly string[];
  readonly recent: readonly string[];
  readonly readmitted: readonly string[];
  readonly pinned: readonly string[];
  readonly loved: readonly string[];
  readonly disliked: readonly string[];
}

export interface TasteOutcome {
  readonly candidates: Candidate[];
  readonly warnings: string[];
  readonly trace: TasteTrace;
}

export interface TrackHint {
  readonly title: string;
  readonly artist: string;
  readonly note: string | null;
}

/** planner 看到的品味提示：全部來自使用者在本 App 的回饋與手動標記，不含 Spotify 資料。 */
export interface TasteHints {
  /** 封鎖＋近 N 已播：不要提名。 */
  readonly avoid: readonly Omit<TrackHint, 'note'>[];
  /** 「愛」：可往相近質地靠，但不必重複提名同一首。 */
  readonly loved: readonly TrackHint[];
  /** 「不對」：短評是軟約束，避開相同理由的選擇。 */
  readonly disliked: readonly TrackHint[];
}

export const EMPTY_TASTE_HINTS: TasteHints = { avoid: [], loved: [], disliked: [] };

const keyOf = (candidate: Candidate): string => trackKeyOf(candidate.artist, candidate.title);

/** 最久沒播（從未播最優先），同樣時再看最近標記的。 */
function pinnedOrder(a: TrackMark, b: TrackMark): number {
  const aired = (a.lastAiredAt ?? '').localeCompare(b.lastAiredAt ?? '');
  return aired !== 0 ? aired : b.updatedAt.localeCompare(a.updatedAt);
}

function pinnedCandidate(mark: TrackMark, index: number, taken: ReadonlySet<string>): Candidate {
  let candidateId = `pin${index + 1}`;
  while (taken.has(candidateId)) candidateId = `${candidateId}x`;
  const named = `接下來是你釘選的歌：${mark.artist} 的〈${mark.title}〉。`;
  return {
    candidateId,
    title: mark.title,
    artist: mark.artist,
    versionHint: null,
    seedBridge: '這首是你釘選的歌，這輪固定排入。',
    transitionBridge: null,
    vibe: ['釘選', '固定排入', '你的選擇'],
    djLine: countGraphemes(named) <= DJ_SHORT_MAX_GRAPHEMES ? named : '接下來是你釘選的歌。',
    evidenceLevel: 'user_description',
    evidenceRefs: [],
    uncertainty: '釘選曲目由你指定，這輪沒有重新分析它和種子的關聯。',
  };
}

function weightOf(mark: TrackMark | undefined): number {
  if (mark?.rating === '愛') return -LOVE_NUDGE;
  if (mark?.rating === '不對') return DISLIKE_PENALTY;
  return 0;
}

export function applyTasteRules(candidates: readonly Candidate[], snapshot: TasteSnapshot, options: TasteRuleOptions): TasteOutcome {
  const window = options.recentWindow ?? RECENT_AIRED_WINDOW;
  const maxPinned = options.maxPinned ?? MAX_PINNED_PER_SHOW;
  const marks = new Map(snapshot.marks.map((mark) => [mark.trackKey, mark]));
  const warnings: string[] = [];

  // 1. blocked 硬排除
  const isBlocked = (key: string): boolean => marks.get(key)?.mark === 'blocked';
  const blocked = candidates.filter((c) => isBlocked(keyOf(c)));
  const unblocked = candidates.filter((c) => !isBlocked(keyOf(c)));

  // 2. 近 N 已播排除
  const recentKeys = snapshot.recentAired.slice(0, Math.max(0, window));
  const recentSet = new Set(recentKeys);
  const recent = unblocked.filter((c) => recentSet.has(keyOf(c)));
  const fresh = unblocked.filter((c) => !recentSet.has(keyOf(c)));

  // 3. pinned（上限 maxPinned）：草稿裡有就用草稿那份，沒有就補一首；近 N 不擋釘選
  const allPins = snapshot.marks.filter((mark) => mark.mark === 'pinned');
  const chosenPins = allPins.sort(pinnedOrder).slice(0, Math.max(0, maxPinned));
  // 未選中的釘選也不能走一般候選或近期補回繞過上限。
  const pinKeys = new Set(allPins.map((mark) => mark.trackKey));
  const takenIds = new Set(candidates.map((c) => c.candidateId));
  const pinned = chosenPins.map((mark, index) => unblocked.find((c) => keyOf(c) === mark.trackKey) ?? pinnedCandidate(mark, index, takenIds));

  // 4. 愛輕推／不對降權（穩定排序：同分維持草稿順序）
  const rest = fresh.filter((c) => !pinKeys.has(keyOf(c)));
  const ranked = rest
    .map((candidate, index) => ({ candidate, score: index + weightOf(marks.get(keyOf(candidate))), index }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((item) => item.candidate);

  // 不足目標時才放回近期已播：最久以前播的先回來，排在最後，並明示
  const shortBy = options.target - pinned.length - ranked.length;
  const age = (c: Candidate): number => recentKeys.indexOf(keyOf(c));
  const readmitted = shortBy > 0
    ? recent.filter((c) => !pinKeys.has(keyOf(c))).sort((a, b) => age(b) - age(a)).slice(0, shortBy)
    : [];
  if (readmitted.length > 0) warnings.push(`近期已播的歌不夠避開：本輪重播 ${readmitted.length} 首最近 ${window} 首內播過的歌。`);
  if (blocked.length > 0 && shortBy - readmitted.length > 0) warnings.push(`已排除 ${blocked.length} 首你封鎖的歌，本輪候選不足 ${options.target} 首。`);

  return {
    candidates: [...pinned, ...ranked, ...readmitted],
    warnings,
    trace: {
      blocked: blocked.map(keyOf),
      recent: recent.map(keyOf),
      readmitted: readmitted.map(keyOf),
      pinned: pinned.map(keyOf),
      loved: ranked.filter((c) => marks.get(keyOf(c))?.rating === '愛').map(keyOf),
      disliked: ranked.filter((c) => marks.get(keyOf(c))?.rating === '不對').map(keyOf),
    },
  };
}

const newestFirst = (a: TrackMark, b: TrackMark): number => b.updatedAt.localeCompare(a.updatedAt);
const toHint = (mark: TrackMark): TrackHint => ({ title: mark.title, artist: mark.artist, note: mark.note });

/** 給 planner 的軟約束：避開清單＋愛／不對（含短評）。 */
export function tasteHintsFor(snapshot: TasteSnapshot, recentWindow = RECENT_AIRED_WINDOW): TasteHints {
  const marks = new Map(snapshot.marks.map((mark) => [mark.trackKey, mark]));
  const blockedKeys = snapshot.marks.filter((mark) => mark.mark === 'blocked').sort(newestFirst).map((mark) => mark.trackKey);
  const avoidKeys = [...new Set([...blockedKeys, ...snapshot.recentAired.slice(0, recentWindow)])].slice(0, MAX_AVOID_HINTS);
  const avoid = avoidKeys.flatMap((key) => {
    const mark = marks.get(key);
    return mark ? [{ title: mark.title, artist: mark.artist }] : [];
  });
  const rated = (rating: TrackMark['rating']): TrackHint[] =>
    snapshot.marks.filter((mark) => mark.rating === rating && mark.mark !== 'blocked').sort(newestFirst).slice(0, MAX_HINTS_PER_LIST).map(toHint);
  return { avoid, loved: rated('愛'), disliked: rated('不對') };
}
