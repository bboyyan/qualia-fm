/**
 * Capability / policy gate. The server is the only authority: no query string, request body,
 * model output or test fallback can turn Spotify or Spotify+DJ on (handoff AGENTS.md rule 3).
 */
import type { Capabilities } from '@qualia/contracts';
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

export function buildCapabilities(config: ServerConfig): Capabilities {
  return {
    mode: config.mode,
    spotifyEnabled: config.gates.spotifyEnabled,
    spotifyDjApproved: config.gates.spotifyDjApproved,
    canPlay: true,
    canSeek: true,
    canProgrammaticallySetVolume: false,
    canInsertSpeech: true,
    canOverlap: false,
    supportsBackground: 'unknown',
    restrictions: [...MOCK_RESTRICTIONS],
  };
}

export type RestrictedFeature = 'spotify_auth' | 'spotify_playback' | 'spotify_dj' | 'tts';

const RESTRICTION_MESSAGE: Record<RestrictedFeature, string> = {
  spotify_auth: 'Spotify 尚未啟用，需先完成整合核對。',
  spotify_playback: 'Spotify 播放尚未啟用，需先完成整合核對。',
  spotify_dj: 'Spotify＋DJ 串接未經核可，不提供。',
  tts: '目前是 MOCK 模式：DJ 只有文字與合成提示音，沒有 AI 語音。',
};

/** Throws FEATURE_RESTRICTED unless the server-side gate is open. Always closed in this build. */
export function assertFeatureAllowed(config: ServerConfig, feature: RestrictedFeature): void {
  const open =
    feature === 'tts'
      ? false
      : feature === 'spotify_dj'
        ? config.gates.spotifyEnabled && config.gates.spotifyDjApproved
        : config.gates.spotifyEnabled;
  if (!open) throw new AppError('FEATURE_RESTRICTED', { message: RESTRICTION_MESSAGE[feature] });
}
