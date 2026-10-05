/**
 * Capability / policy gate. The server is the only authority: no query string, request body,
 * model output or test fallback can turn Spotify or Spotify+DJ on (handoff AGENTS.md rule 3).
 */
import { SPOTIFY_SCOPES, type Capabilities } from '@qualia/contracts';
import { AppError } from '../http/errors.js';
import type { ServerConfig } from '../config/env.js';

export const MOCK_RESTRICTIONS: readonly string[] = [
  '只播放程式合成的測試音（MOCK），不是真實音樂，也不能檢驗選歌品質。',
  '曲目與藝人皆為虛構示意，不連結任何真實作品。',
  'DJ 介紹以合成提示音＋文字模擬，不是 AI 語音。',
  'Spotify 尚未啟用：需先完成政策、帳號與手機播放核對（G0）。',
  '背景與鎖屏連播未在真機驗證，不保證。',
  '音量請使用裝置音量鍵，本站不控制系統音量。',
];

const SPOTIFY_NOT_ENABLED = 'Spotify 尚未啟用';
const SPOTIFY_ENABLED_RESTRICTIONS: readonly string[] = [
  'Spotify 已由伺服器啟用：只把 AI 提名的曲名／藝人對應成可播放的歌，任何 Spotify 資料都不交給 AI、不寫進帳本。',
];
const SPOTIFY_MANUAL_ONLY = 'E 模式（自動串接）未核可：只能登入與在 Spotify 開啟連結，自己播放。';

export interface SpotifyStatus {
  readonly linked: boolean;
}

function restrictionsFor(config: ServerConfig, aiVoiceLive: boolean, reason: string | null): string[] {
  const base = MOCK_RESTRICTIONS.filter((text) => !aiVoiceLive || !text.includes('不是 AI 語音'));
  const spotify = config.gates.spotifyEnabled
    ? [...base.filter((text) => !text.startsWith(SPOTIFY_NOT_ENABLED)), ...SPOTIFY_ENABLED_RESTRICTIONS, ...(config.gates.spotifyDjApproved ? [] : [SPOTIFY_MANUAL_ONLY])]
    : base;
  return [...spotify, ...(reason ? [reason] : [])];
}

export function buildCapabilities(config: ServerConfig, reason: string | null = config.openai.reason, spotify: SpotifyStatus = { linked: false }): Capabilities {
  // 只有真的可用（無降級原因）才移除「不是 AI 語音」；只「設定」openai 但被 gate 擋住時仍要如實標示。
  const aiVoiceLive = !reason && config.openai.tts === 'openai';
  const spotifyInfo = config.gates.spotifyEnabled
    ? { spotify: {
        linked: spotify.linked,
        clientId: config.spotify.clientId ?? '',
        redirectUri: config.spotify.redirectUri ?? '',
        lovedPlaylistId: config.spotify.lovedPlaylistId,
        scopes: [...SPOTIFY_SCOPES],
      } }
    : {};
  return {
    ...spotifyInfo,
    mode: config.mode,
    providers: { llm: reason ? 'mock' : config.openai.llm, tts: reason ? 'mock' : config.openai.tts, reason },
    spotifyEnabled: config.gates.spotifyEnabled,
    spotifyDjApproved: config.gates.spotifyDjApproved,
    canPlay: true,
    canSeek: true,
    canProgrammaticallySetVolume: false,
    canInsertSpeech: true,
    canOverlap: false,
    supportsBackground: 'unknown',
    restrictions: restrictionsFor(config, aiVoiceLive, reason),
  };
}

export type RestrictedFeature = 'spotify_auth' | 'spotify_playback' | 'spotify_dj' | 'tts';

const RESTRICTION_MESSAGE: Record<RestrictedFeature, string> = {
  spotify_auth: 'Spotify 尚未啟用，需先完成整合核對。',
  spotify_playback: 'Spotify 播放尚未啟用，需先完成整合核對。',
  spotify_dj: 'Spotify＋DJ 串接未經核可，不提供。',
  tts: '目前是 MOCK 模式：DJ 只有文字與合成提示音，沒有 AI 語音。',
};

/** Throws FEATURE_RESTRICTED unless the server-side gate is open (closed by default). */
export function assertFeatureAllowed(config: ServerConfig, feature: RestrictedFeature): void {
  const open =
    feature === 'tts'
      ? false
      : feature === 'spotify_dj'
        ? config.gates.spotifyEnabled && config.gates.spotifyDjApproved
        : config.gates.spotifyEnabled;
  if (!open) throw new AppError('FEATURE_RESTRICTED', { message: RESTRICTION_MESSAGE[feature] });
}
