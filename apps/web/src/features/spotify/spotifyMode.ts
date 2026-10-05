/**
 * E 模式的純函式判斷。伺服器 capabilities 是唯一權威：網頁只能在伺服器允許的範圍內選擇，
 * 不從 query、模型輸出或本機儲存推出任何「開啟」。
 */
import type { Capabilities, Segment } from '@qualia/contracts';
import type { PlaybackMode } from '../../audio/types';

/** 使用者在伺服器允許時的選擇；預設 on＝連結 Spotify 本身就是明確同意。改選 B／MOCK 即為 off。 */
export type EModePreference = 'on' | 'off';
export type LinkOutcome = 'linked' | 'denied' | 'error' | 'session' | 'owner';

const LINK_OUTCOMES: readonly LinkOutcome[] = ['linked', 'denied', 'error', 'session', 'owner'];

export const LINK_MESSAGES: Record<LinkOutcome, string> = {
  linked: '已連結 Spotify。E 模式開啟：每首前先播完 AI 介紹，再由這個網頁播放。',
  denied: '你在 Spotify 取消了授權，E 模式維持關閉。',
  error: 'Spotify 連結沒有完成，E 模式維持關閉，可以再試一次。',
  session: '工作階段已過期，請重新整理後再連結 Spotify。',
  owner: 'Spotify 已由另一台裝置連結；只有完成連結的那台裝置能使用或中斷，E 模式在這裡維持關閉。',
};

export function eModeAvailable(caps: Capabilities | null): boolean {
  return Boolean(caps?.spotifyEnabled && caps.spotifyDjApproved && caps.spotify?.linked);
}

export function effectivePlaybackMode(settingsMode: 'manual' | 'mock', caps: Capabilities | null, preference: EModePreference): PlaybackMode {
  return eModeAvailable(caps) && preference === 'on' ? 'spotify' : settingsMode;
}

/** 「愛」可加入 Qualia Loved：伺服器啟用、已連結，且這首有 Spotify 對應。 */
export function lovedAvailable(caps: Capabilities | null, segment: Segment): boolean {
  return Boolean(caps?.spotifyEnabled && caps.spotify?.linked && segment.track.audioLocator.kind === 'spotify_uri');
}

export function readLinkOutcome(search: string): LinkOutcome | null {
  const value = new URLSearchParams(search).get('spotify');
  return LINK_OUTCOMES.find((outcome) => outcome === value) ?? null;
}

/** 授權回來後清掉網址上的 ?spotify=…（只移除這個參數，保留其他參數與 hash）。 */
export function urlWithoutLinkOutcome(pathname: string, search: string, hash = ''): string {
  const params = new URLSearchParams(search);
  params.delete('spotify');
  const rest = params.toString();
  return `${pathname}${rest ? `?${rest}` : ''}${hash}`;
}

export interface ModeStripLabels {
  readonly selection: string;
  readonly playback: string;
  readonly ledger: string;
}

const PLAYBACK_LABEL: Record<PlaybackMode, string> = {
  manual: '手動（E 模式關）',
  mock: 'MOCK 測試音',
  spotify: 'Spotify 自動串接（E）',
};

/** 頂端三格：選曲／語音、播放、帳本，如實標示（R7 模式混淆）。帳本目前固定為 TEST 假帳本。 */
export function modeStrip(caps: Capabilities | null, playbackMode: PlaybackMode): ModeStripLabels {
  const llm = caps?.providers?.llm === 'openai';
  const tts = caps?.providers?.tts === 'openai';
  const selection = llm && tts ? '真 AI' : llm ? '真 AI 選曲・MOCK 語音' : tts ? 'MOCK 選曲・AI 語音' : 'MOCK';
  return { selection, playback: PLAYBACK_LABEL[playbackMode], ledger: 'TEST 假帳本' };
}
