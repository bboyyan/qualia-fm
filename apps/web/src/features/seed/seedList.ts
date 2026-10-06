/**
 * 開台草稿與種子清單（BRA-117 A）。預設「歌曲」模式，清單裡先放曄確認過的唯一種子；
 * 可加入其他歌、可多選，勾選的種子合併成一個歌曲 Seed 送出（契約不變）。
 * 不推測其他偏好：清單只放使用者自己輸入的歌，另讀 Qualia 品味帳本的釘選／愛；不讀 Spotify 收藏、紀錄或歌單。
 */
import { ARTIST_MAX_GRAPHEMES, SEED_MAX_GRAPHEMES, countGraphemes, type PlanRequest, type SeedKind, type TrackMark, trackKeyOf } from '@qualia/contracts';
import type { Settings } from '../settings/settings';
import { pickSelected, toggleId } from './selection';

export interface SongSeed {
  readonly id: string;
  readonly title: string;
  readonly artist: string | null;
  /** 版本等補充說明（只顯示）。 */
  readonly note: string | null;
  readonly isDefault: boolean;
  /** 帳本來源不可在開台頁刪除；ledgerOnly 用來區分與手動項目的交集。 */
  readonly fromLedger?: boolean;
  readonly ledgerOnly?: boolean;
}

export interface Draft {
  readonly kind: SeedKind;
  /** 感覺／聲音模式的輸入；歌曲模式是「加入一首」的歌名欄。 */
  readonly text: string;
  readonly artist: string;
  readonly seeds: readonly SongSeed[];
  readonly selectedSeedIds: readonly string[];
  /** 最近一次帳本同步的封鎖鍵，避免手動加入繞過封鎖。 */
  readonly blockedSeedKeys?: readonly string[];
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

const seedKey = (title: string, artist: string | null): string => trackKeyOf(artist ?? '', title);

/** 重讀帳本後合併草稿：新增候選不自動勾選，保留本輪選取；封鎖優先於所有來源。 */
export function mergeLedgerSeeds(draft: Draft, marks: readonly TrackMark[]): Draft {
  const keyOf = (seed: SongSeed): string => trackKeyOf(seed.artist ?? '', seed.title);
  const blocked = new Set(marks.filter((song) => song.mark === 'blocked').map((song) => trackKeyOf(song.artist, song.title)));
  const previous = new Map(draft.seeds.map((seed) => [keyOf(seed), seed]));
  const seeds: SongSeed[] = draft.seeds.filter((seed) => !seed.ledgerOnly && !blocked.has(keyOf(seed)))
    .map((seed) => ({ ...seed, fromLedger: false }));
  for (const song of marks) {
    const key = trackKeyOf(song.artist, song.title);
    if (blocked.has(key) || (song.mark !== 'pinned' && song.rating !== '愛')) continue;
    const index = seeds.findIndex((seed) => keyOf(seed) === key);
    if (index >= 0) {
      seeds[index] = { ...seeds[index]!, fromLedger: true };
    } else {
      const old = previous.get(key);
      seeds.push({ id: old?.id ?? `taste:${key}`, title: song.title, artist: song.artist,
        note: null, isDefault: false, fromLedger: true, ledgerOnly: true });
    }
  }
  const ids = new Set(seeds.map((seed) => seed.id));
  return { ...draft, seeds, blockedSeedKeys: [...blocked], selectedSeedIds: draft.selectedSeedIds.filter((id) => ids.has(id)) };
}

/** 加入一首並勾選；同名同藝人已在清單就只勾選，不重複。 */
export function addSongSeed(draft: Draft, title: string, artist: string): Draft {
  const cleanTitle = title.trim().replace(/\s+/g, ' ');
  if (!cleanTitle) return draft;
  const cleanArtist = artist.trim().replace(/\s+/g, ' ') || null;
  const key = seedKey(cleanTitle, cleanArtist);
  if (draft.blockedSeedKeys?.includes(key)) return draft;
  const existing = draft.seeds.find((seed) => seedKey(seed.title, seed.artist) === key);
  if (existing) {
    return draft.selectedSeedIds.includes(existing.id) ? draft : { ...draft, selectedSeedIds: [...draft.selectedSeedIds, existing.id] };
  }
  const seed: SongSeed = { id: `song:${key}`, title: cleanTitle, artist: cleanArtist, note: null, isDefault: false };
  return { ...draft, seeds: [...draft.seeds, seed], selectedSeedIds: [...draft.selectedSeedIds, seed.id] };
}

/** 預設與帳本來源只能取消勾選；純手動項目可移除。 */
export function removeSongSeed(draft: Draft, id: string): Draft {
  const target = draft.seeds.find((seed) => seed.id === id);
  if (!target || target.isDefault || target.fromLedger) return draft;
  return { ...draft, seeds: draft.seeds.filter((seed) => seed.id !== id), selectedSeedIds: draft.selectedSeedIds.filter((value) => value !== id) };
}

export function toggleSongSeed(draft: Draft, id: string): Draft {
  return { ...draft, selectedSeedIds: toggleId(draft.selectedSeedIds, id) };
}

const pendingSongBlocked = (draft: Draft): boolean => Boolean(draft.blockedSeedKeys?.includes(seedKey(draft.text, draft.artist)));

/** 歌曲模式送出時，輸入框裡還沒按「加入」的歌名也算一首：加入清單並清空輸入。 */
export function withPendingSong(draft: Draft): Draft {
  if (draft.kind !== 'song' || !draft.text.trim() || pendingSongBlocked(draft)) return draft;
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
  if (draft.text.trim() && pendingSongBlocked(draft)) return '這首歌已封鎖，請到「我的歌」解除封鎖後再加入。';
  const seeds = selectedSeeds(withPendingSong(draft));
  if (seeds.length === 0) return '請至少勾選一首種子歌，或在下面輸入歌名加入。';
  const combined = combineSeeds(seeds);
  if (countGraphemes(combined.text) > SEED_MAX_GRAPHEMES) return `勾選的歌名合計超過 ${SEED_MAX_GRAPHEMES} 字，請少選幾首。`;
  if (combined.artist && countGraphemes(combined.artist) > ARTIST_MAX_GRAPHEMES) return `勾選的藝人合計超過 ${ARTIST_MAX_GRAPHEMES} 字，請少選幾首。`;
  return null;
}

/**
 * 「我的歌」的「當種子開台」（BRA-135）：只用這一首當歌曲種子。不動開台頁的草稿，
 * 使用者自己輸入到一半的內容保留；重試沿用這次的請求。
 */
export function songSeedRequest(title: string, artist: string, settings: Settings): PlanRequest {
  const solo = addSongSeed({ ...DEFAULT_DRAFT, seeds: [], selectedSeedIds: [] }, title, artist);
  return toPlanRequest(solo, settings);
}

export function toPlanRequest(draft: Draft, settings: Settings, tuning: string | null = null): PlanRequest {
  const dj = { enabled: settings.djEnabled, length: settings.djLength };
  if (draft.kind === 'song') {
    const { text, artist } = combineSeeds(selectedSeeds(withPendingSong(draft)));
    return { seed: { kind: 'song', text, artist }, requestedCount: 5, dj, tuning };
  }
  return { seed: { kind: draft.kind, text: draft.text.trim(), artist: null }, requestedCount: 5, dj, tuning };
}
