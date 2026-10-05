/**
 * 開台草稿與種子清單（BRA-117 A）。預設「歌曲」模式，清單裡先放曄確認過的唯一種子；
 * 可加入其他歌、可多選，勾選的種子合併成一個歌曲 Seed 送出（契約不變）。
 * 不推測其他偏好：清單只放使用者自己輸入的歌，不讀 Spotify 收藏、紀錄或歌單。
 */
import { ARTIST_MAX_GRAPHEMES, SEED_MAX_GRAPHEMES, countGraphemes, type PlanRequest, type SeedKind } from '@qualia/contracts';
import type { Settings } from '../settings/settings';
import { pickSelected, toggleId } from './selection';

export interface SongSeed {
  readonly id: string;
  readonly title: string;
  readonly artist: string | null;
  /** 版本等補充說明（只顯示）。 */
  readonly note: string | null;
  readonly isDefault: boolean;
}

export interface Draft {
  readonly kind: SeedKind;
  /** 感覺／聲音模式的輸入；歌曲模式是「加入一首」的歌名欄。 */
  readonly text: string;
  readonly artist: string;
  readonly seeds: readonly SongSeed[];
  readonly selectedSeedIds: readonly string[];
}

/** 曄確認過的唯一種子（REQUIREMENTS A1-2、D1：Frieren OST 版）。 */
export const DEFAULT_SEED: SongSeed = {
  id: 'default:time-flows-ever-onward',
  title: 'Time Flows Ever Onward',
  artist: 'Evan Call',
  note: '《葬送的芙莉蓮》原聲帶版',
  isDefault: true,
};

/**
 * 預設種子對應的 Spotify 曲目（Frieren OST 版）。只供對照與文件，不進選歌請求、不送 LLM
 * （Policy III.14：LLM 只吃種子文字）。
 */
export const DEFAULT_SEED_SPOTIFY_URI = 'spotify:track:5filwtvsV0xyRFqja0Whtr';

export const DEFAULT_DRAFT: Draft = {
  kind: 'song',
  text: '',
  artist: '',
  seeds: [DEFAULT_SEED],
  selectedSeedIds: [DEFAULT_SEED.id],
};

const SEPARATOR = '／';

const normalize = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase();
const seedKey = (title: string, artist: string | null): string => `${normalize(title)}|${normalize(artist ?? '')}`;

/** 加入一首並勾選；同名同藝人已在清單就只勾選，不重複。 */
export function addSongSeed(draft: Draft, title: string, artist: string): Draft {
  const cleanTitle = title.trim().replace(/\s+/g, ' ');
  if (!cleanTitle) return draft;
  const cleanArtist = artist.trim().replace(/\s+/g, ' ') || null;
  const key = seedKey(cleanTitle, cleanArtist);
  const existing = draft.seeds.find((seed) => seedKey(seed.title, seed.artist) === key);
  if (existing) {
    return draft.selectedSeedIds.includes(existing.id) ? draft : { ...draft, selectedSeedIds: [...draft.selectedSeedIds, existing.id] };
  }
  const seed: SongSeed = { id: `song:${key}`, title: cleanTitle, artist: cleanArtist, note: null, isDefault: false };
  return { ...draft, seeds: [...draft.seeds, seed], selectedSeedIds: [...draft.selectedSeedIds, seed.id] };
}

/** 預設種子不能刪（只能取消勾選＝更換）；其他的可移除。 */
export function removeSongSeed(draft: Draft, id: string): Draft {
  const target = draft.seeds.find((seed) => seed.id === id);
  if (!target || target.isDefault) return draft;
  return { ...draft, seeds: draft.seeds.filter((seed) => seed.id !== id), selectedSeedIds: draft.selectedSeedIds.filter((value) => value !== id) };
}

export function toggleSongSeed(draft: Draft, id: string): Draft {
  return { ...draft, selectedSeedIds: toggleId(draft.selectedSeedIds, id) };
}

/** 歌曲模式送出時，輸入框裡還沒按「加入」的歌名也算一首：加入清單並清空輸入。 */
export function withPendingSong(draft: Draft): Draft {
  if (draft.kind !== 'song' || !draft.text.trim()) return draft;
  return { ...addSongSeed(draft, draft.text, draft.artist), text: '', artist: '' };
}

export function selectedSeeds(draft: Draft): SongSeed[] {
  return pickSelected(draft.seeds, draft.selectedSeedIds, (seed) => seed.id);
}

/** 多首種子合併成一個歌曲 Seed：曲名、藝人各自用「／」串起來（藝人去重）。 */
export function combineSeeds(seeds: readonly SongSeed[]): { text: string; artist: string | null } {
  const artists = [...new Set(seeds.map((seed) => seed.artist).filter((value): value is string => Boolean(value)))];
  return { text: seeds.map((seed) => seed.title).join(SEPARATOR), artist: artists.length > 0 ? artists.join(SEPARATOR) : null };
}

export function textProblem(text: string): string | null {
  if (text.trim().length === 0) return '先寫下一點感覺，或點一個範例。';
  if (countGraphemes(text) > SEED_MAX_GRAPHEMES) return `請縮短至 ${SEED_MAX_GRAPHEMES} 字以內，輸入已保留。`;
  return null;
}

/** 送出前的檢查；回傳給人看的下一步，沒問題回 null。 */
export function draftProblem(draft: Draft): string | null {
  if (draft.kind !== 'song') return textProblem(draft.text);
  const seeds = selectedSeeds(withPendingSong(draft));
  if (seeds.length === 0) return '請至少勾選一首種子歌，或在下面輸入歌名加入。';
  const combined = combineSeeds(seeds);
  if (countGraphemes(combined.text) > SEED_MAX_GRAPHEMES) return `勾選的歌名合計超過 ${SEED_MAX_GRAPHEMES} 字，請少選幾首。`;
  if (combined.artist && countGraphemes(combined.artist) > ARTIST_MAX_GRAPHEMES) return `勾選的藝人合計超過 ${ARTIST_MAX_GRAPHEMES} 字，請少選幾首。`;
  return null;
}

export function toPlanRequest(draft: Draft, settings: Settings, tuning: string | null = null): PlanRequest {
  const dj = { enabled: settings.djEnabled, length: settings.djLength };
  if (draft.kind === 'song') {
    const { text, artist } = combineSeeds(selectedSeeds(withPendingSong(draft)));
    return { seed: { kind: 'song', text, artist }, requestedCount: 5, dj, tuning };
  }
  return { seed: { kind: draft.kind, text: draft.text.trim(), artist: null }, requestedCount: 5, dj, tuning };
}
