/**
 * 開台草稿與種子清單（BRA-117 A）。預設「歌曲」模式，清單裡先放曄確認過的唯一種子；
 * 可加入其他歌、可多選，勾選的種子合併成一個歌曲 Seed 送出（契約不變）。
 * 不推測其他偏好：清單只放使用者自己輸入的歌，另讀 Qualia 品味帳本的釘選／愛；不讀 Spotify 收藏、紀錄或歌單。
 */
import { ARTIST_MAX_GRAPHEMES, SEED_MAX_GRAPHEMES, countGraphemes, type PlanRequest, type SeedKind, type TrackMark, trackKeyOf } from '@qualia/contracts';
import type { Settings } from '../settings/settings';
import { pickSelected, startLabel, toggleId } from './selection';

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

/** BRA-170：「從一種感覺」的 8 個情境標籤。label 給人看，prompt 是實際送去選歌的文字（照設計稿 README，不可改寫）。 */
export const MOOD_PRESETS = [
  { id: 'calm', label: '平靜', prompt: '平靜下來的心情：放慢呼吸，柔和、多一點留白' },
  { id: 'uplift', label: '振奮', prompt: '想被振奮：明亮、有推進感，讓人想動起來' },
  { id: 'workout', label: '健身', prompt: '運動時穩定推進的節奏與能量' },
  { id: 'heartbreak', label: '失戀', prompt: '失戀後的心情：有點空、溫柔，慢慢走出來' },
  { id: 'late-night', label: '深夜', prompt: '深夜獨處：安靜、貼近耳邊，不吵醒誰' },
  { id: 'commute', label: '通勤', prompt: '通勤路上：順順地往前走，不打擾思緒' },
  { id: 'focus', label: '專注', prompt: '需要專注：穩定、少人聲，不搶注意力' },
  { id: 'rainy', label: '雨天', prompt: '雨天的氣氛：潮濕、慵懶，帶一點溫度' },
] as const satisfies readonly { id: string; label: string; prompt: string }[];

export type MoodId = (typeof MOOD_PRESETS)[number]['id'];

export interface Draft {
  readonly kind: SeedKind;
  /** 歌曲模式「加入一首」的歌名欄（舊的聲音模式也用這欄）。 */
  readonly text: string;
  /** 從一種感覺：選中的情境標籤（單選）。選填欄位，舊草稿沒有時視為 null。 */
  readonly mood?: MoodId | null;
  /** 從一種感覺：「再補一句」。和歌名欄分開，切模式時互不覆蓋；舊草稿沒有時視為空字串。 */
  readonly feelingText?: string;
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
  mood: null,
  feelingText: '',
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

/** D-41：開台鈕只統計可見列；收合的帳本列不改變選取或送出的種子。 */
export function songStartLabel(verb: string, draft: Draft, ledgerExpanded: boolean): string {
  const visible = draft.seeds.filter((seed) => !seed.ledgerOnly || ledgerExpanded);
  const selected = visible.filter((seed) => draft.selectedSeedIds.includes(seed.id));
  return startLabel(verb, selected.length, visible.length);
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

const moodOf = (id: MoodId | null | undefined) => MOOD_PRESETS.find((mood) => mood.id === id) ?? null;

/** 組 seed.text：只有標籤＝prompt；標籤＋句＝「prompt。句」；只有句＝句。全空回空字串。 */
export function composeFeelingText(mood: MoodId | null | undefined, text: string | undefined): string {
  const own = (text ?? '').trim();
  const preset = moodOf(mood);
  if (!preset) return own;
  return own ? `${preset.prompt}。${own}` : preset.prompt;
}

/** 單選：點同一個取消，點別的換掉。 */
export function toggleMood(draft: Draft, id: MoodId): Draft {
  return { ...draft, mood: draft.mood === id ? null : id };
}

/** 範例 chip：取代「再補一句」（不附加）；在從一首歌點會切到從一種感覺，不選標籤、不動歌曲勾選。再點同一句清空。 */
export function applyExample(draft: Draft, example: string): Draft {
  if (draft.kind === 'feeling' && draft.feelingText === example) return { ...draft, feelingText: '' };
  return { ...draft, kind: 'feeling', feelingText: example };
}

/** 從一種感覺的主按鈕：有標籤寫「從「X」…」，否則沿用現行「為我開台」／「建立下一段」。 */
export function feelingStartLabel(draft: Draft, continuing: boolean): string {
  const preset = moodOf(draft.mood);
  if (preset) return `從「${preset.label}」${continuing ? '建立下一段' : '開台'}`;
  return continuing ? '建立下一段' : '為我開台';
}

/** 送出前的檢查；回傳給人看的下一步，沒問題回 null。 */
export function draftProblem(draft: Draft): string | null {
  if (draft.kind === 'feeling') {
    const text = composeFeelingText(draft.mood, draft.feelingText);
    return text ? textProblem(text) : '先選一個感覺，或寫一句。';
  }
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
  return { seed: { kind: draft.kind, text: draftSeedText(draft), artist: null }, requestedCount: 5, dj, tuning };
}

/** 這份草稿實際會送出的 seed.text（生成畫面在請求還沒建立前也用它）。 */
export function draftSeedText(draft: Draft): string {
  if (draft.kind === 'song') return combineSeeds(selectedSeeds(withPendingSong(draft))).text;
  if (draft.kind === 'feeling') return composeFeelingText(draft.mood, draft.feelingText);
  return draft.text.trim();
}
