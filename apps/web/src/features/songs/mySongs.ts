/**
 * 「我的歌」（BRA-135）的純函式：濾鏡、搜尋、排序、釘選名額與帳本紀錄的文字。
 * 資料一律是品味帳本（BRA-134）的 TrackMark／LedgerEntry；這裡不另存任何清單。
 * 「收藏」＝評價「愛」（帳本沒有獨立的收藏標記）；取消收藏改記「還行」，選歌規則對「還行」不加權。
 */
import { PINNED_LIMIT, type LedgerEntry, type TasteEditRequest, type TrackMark } from '@qualia/contracts';

export type SongFilter = 'all' | 'loved' | 'blocked' | 'recent';
export type SongAction = 'love' | 'pin' | 'block';

/** 「最近」濾鏡：這幾天內有播出或評價／標記的歌。 */
export const RECENT_DAYS = 14;
const DAY_MS = 86_400_000;

export const FILTER_OPTIONS: readonly { value: SongFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'loved', label: '收藏' },
  { value: 'blocked', label: '封鎖' },
  { value: 'recent', label: '最近' },
];

export const PIN_FULL_MESSAGE = `釘選已滿 ${PINNED_LIMIT} 首（每輪開台都會帶上），先取消一首再釘。`;

const normalize = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

export const isBlocked = (song: TrackMark): boolean => song.mark === 'blocked';
export const isPinned = (song: TrackMark): boolean => song.mark === 'pinned';
/** 收藏按鈕只反映評價；釘選與評價是各自獨立的狀態。 */
export const isLoved = (song: TrackMark): boolean => song.rating === '愛';

/** 最近一次動到這首歌的時間（評價／標記或播出，取較新的）。 */
export function lastActivity(song: TrackMark): string {
  return song.lastAiredAt && song.lastAiredAt > song.updatedAt ? song.lastAiredAt : song.updatedAt;
}

export function matchesQuery(song: TrackMark, query: string): boolean {
  const needle = normalize(query);
  if (!needle) return true;
  return normalize(song.title).includes(needle) || normalize(song.artist).includes(needle);
}

function matchesFilter(song: TrackMark, filter: SongFilter, now: number): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'loved':
      // 濾鏡沿用「愛或釘選、封鎖優先」；不影響收藏按鈕的切換。
      return !isBlocked(song) && (isLoved(song) || isPinned(song));
    case 'blocked':
      return isBlocked(song);
    case 'recent':
      return Date.parse(lastActivity(song)) >= now - RECENT_DAYS * DAY_MS;
  }
}

const byActivity = (a: TrackMark, b: TrackMark): number => lastActivity(b).localeCompare(lastActivity(a));
/** 釘選在前、封鎖沉底，其餘依最近動到的先。 */
const rank = (song: TrackMark): number => (isPinned(song) ? 0 : isBlocked(song) ? 2 : 1);
const byPinnedThenActivity = (a: TrackMark, b: TrackMark): number => rank(a) - rank(b) || byActivity(a, b);

export interface SongQuery {
  readonly filter: SongFilter;
  readonly query: string;
}

/** 依濾鏡＋搜尋挑出要顯示的歌；「最近」純粹依時間排，其他把釘選放最前。 */
export function visibleSongs(songs: readonly TrackMark[], { filter, query }: SongQuery, now: number): TrackMark[] {
  const picked = songs.filter((song) => matchesFilter(song, filter, now) && matchesQuery(song, query));
  return picked.sort(filter === 'recent' ? byActivity : byPinnedThenActivity);
}

export const pinnedCount = (songs: readonly TrackMark[]): number => songs.filter(isPinned).length;

/** 這首能不能再釘：已釘選、還有名額、或已滿。 */
export function pinState(songs: readonly TrackMark[], song: TrackMark): 'pinned' | 'available' | 'full' {
  if (isPinned(song)) return 'pinned';
  return pinnedCount(songs) >= PINNED_LIMIT ? 'full' : 'available';
}

/** 單曲動作 → 帳本編輯（target 由呼叫端補上 trackKey）。 */
export function editFor(action: SongAction, on: boolean): Omit<TasteEditRequest, 'target'> {
  switch (action) {
    case 'love':
      return { rating: on ? '愛' : '還行' };
    case 'pin':
      return { mark: on ? 'pinned' : null };
    case 'block':
      return { mark: on ? 'blocked' : null };
  }
}

export function doneMessage(action: SongAction, on: boolean, title: string): string {
  const name = `〈${title}〉`;
  switch (action) {
    case 'love':
      return on ? `已收藏${name}。` : `已取消收藏${name}，評價改為「還行」。`;
    case 'pin':
      return on ? `已釘選${name}，之後每輪開台都會帶上。` : `已取消釘選${name}。`;
    case 'block':
      return on ? `已封鎖${name}，不會再排進節目。` : `已解除封鎖${name}。`;
  }
}

/** 一句話說明最近的評價（含短評）；沒評過回 null。 */
export function ratingSummary(song: TrackMark): string | null {
  if (!song.rating) return null;
  return song.note ? `${song.rating}・「${song.note}」` : song.rating;
}

const MARK_LABEL = { pinned: '釘選', blocked: '封鎖' } as const;

/** 帳本紀錄的一行說明（短評另由 entryNote 給，畫面上當成使用者資料呈現）。 */
export function entryLabel(entry: LedgerEntry): string {
  switch (entry.kind) {
    case 'feedback':
      return `聽完回饋：${entry.rating}`;
    case 'rating':
      return `改評價：${entry.rating}`;
    case 'mark':
      return entry.mark ? MARK_LABEL[entry.mark] : '取消釘選／封鎖';
    case 'aired':
      return '排進節目';
  }
}

/** 這筆紀錄附的短評；沒有回 null。 */
export function entryNote(entry: LedgerEntry): string | null {
  return (entry.kind === 'feedback' || entry.kind === 'rating') && entry.note.trim() ? entry.note : null;
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** 本機時間 MM/DD HH:mm。 */
export function shortTime(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function emptyMessage(filter: SongFilter, query: string): string {
  if (query.trim()) return `找不到「${query.trim()}」。換個曲名或藝人試試。`;
  switch (filter) {
    case 'all':
      return '還沒有歌。';
    case 'loved':
      return '還沒有收藏的歌。按歌名下的「收藏」，就會出現在這裡。';
    case 'blocked':
      return '沒有封鎖的歌。';
    case 'recent':
      return `最近 ${RECENT_DAYS} 天沒有播出或評價過的歌。`;
  }
}
