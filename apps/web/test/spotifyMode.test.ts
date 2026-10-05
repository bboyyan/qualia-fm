import { describe, expect, it } from 'vitest';
import type { Capabilities } from '@qualia/contracts';
import { LINK_MESSAGES, effectivePlaybackMode, eModeAvailable, lovedAvailable, modeStrip, readLinkOutcome, urlWithoutLinkOutcome } from '../src/features/spotify/spotifyMode';
import { segment } from './fixtures';
import { spotifySegment } from './spotifyFakes';

const base: Capabilities = {
  mode: 'mock',
  spotifyEnabled: false,
  spotifyDjApproved: false,
  canPlay: true,
  canSeek: true,
  canProgrammaticallySetVolume: false,
  canInsertSpeech: true,
  canOverlap: false,
  supportsBackground: 'unknown',
  providers: { llm: 'mock', tts: 'mock', reason: null },
  restrictions: [],
};
const spotify = (linked: boolean) => ({ linked, clientId: 'TESTclientid0000', redirectUri: 'https://qualia.example.test/callback', lovedPlaylistId: '0dF9anAJZv0IotD6lo2kl2', scopes: [] });
const enabled = (linked: boolean, dj: boolean): Capabilities => ({ ...base, spotifyEnabled: true, spotifyDjApproved: dj, spotify: spotify(linked) });

describe('E 模式是否生效：伺服器為唯一權威', () => {
  it('預設（伺服器關閉）永遠不是 E，偏好設 on 也一樣', () => {
    expect(eModeAvailable(base)).toBe(false);
    expect(eModeAvailable(null)).toBe(false);
    expect(effectivePlaybackMode('manual', base, 'on')).toBe('manual');
    expect(effectivePlaybackMode('mock', base, 'on')).toBe('mock');
  });

  it('只有 SPOTIFY_ENABLED（未核可 DJ）或尚未連結時不是 E', () => {
    expect(effectivePlaybackMode('manual', enabled(true, false), 'on')).toBe('manual');
    expect(effectivePlaybackMode('manual', enabled(false, true), 'on')).toBe('manual');
  });

  it('核可＋已連結＋使用者沒有改回 B／MOCK → E', () => {
    expect(effectivePlaybackMode('manual', enabled(true, true), 'on')).toBe('spotify');
    expect(effectivePlaybackMode('mock', enabled(true, true), 'off')).toBe('mock');
  });
});

describe('「愛」→ Loved 是否提供', () => {
  it('需要伺服器啟用、已連結，且這首有 Spotify 對應', () => {
    expect(lovedAvailable(enabled(true, false), spotifySegment())).toBe(true);
    expect(lovedAvailable(enabled(false, false), spotifySegment())).toBe(false);
    expect(lovedAvailable(base, spotifySegment())).toBe(false);
    expect(lovedAvailable(enabled(true, true), segment('s', 1))).toBe(false);
  });
});

describe('登入回呼結果與模式列', () => {
  it('只認得七種結果，其他一律忽略', () => {
    expect(readLinkOutcome('?spotify=linked')).toBe('linked');
    expect(readLinkOutcome('?spotify=denied')).toBe('denied');
    // BRA-111 A1：已由別的裝置連結時，登入被導回 ?spotify=owner。
    expect(readLinkOutcome('?spotify=owner')).toBe('owner');
    expect(LINK_MESSAGES.owner).toContain('另一台裝置');
    // 審查必修：不是 SPOTIFY_OWNER_USER_ID 的帳號、或伺服器未設定擁有者帳號。
    expect(readLinkOutcome('?spotify=account')).toBe('account');
    expect(LINK_MESSAGES.account).toContain('不是這台伺服器設定的擁有者帳號');
    expect(readLinkOutcome('?spotify=unconfigured')).toBe('unconfigured');
    expect(LINK_MESSAGES.unconfigured).toContain('尚未設定擁有者帳號');
    expect(readLinkOutcome('?spotify=<script>')).toBeNull();
    expect(readLinkOutcome('')).toBeNull();
  });

  it('授權回來後清掉 ?spotify=…：/?spotify=linked → /（E2E 的 toHaveURL 結尾斜線斷言依賴這個）', () => {
    expect(urlWithoutLinkOutcome('/', '?spotify=linked')).toBe('/');
    expect(urlWithoutLinkOutcome('/', '?spotify=denied&x=1', '#top')).toBe('/?x=1#top');
    expect(urlWithoutLinkOutcome('/', '')).toBe('/');
  });

  it('模式列如實標示 MOCK／真 AI／Spotify 與 TEST 帳本', () => {
    expect(modeStrip(base, 'manual')).toEqual({ selection: 'MOCK', playback: '手動（E 模式關）', ledger: 'TEST 假帳本' });
    expect(modeStrip({ ...enabled(true, true), providers: { llm: 'openai', tts: 'openai', reason: null } }, 'spotify')).toEqual({ selection: '真 AI', playback: 'Spotify 自動串接（E）', ledger: 'TEST 假帳本' });
    expect(modeStrip({ ...base, providers: { llm: 'openai', tts: 'mock', reason: null } }, 'mock').selection).toBe('真 AI 選曲・MOCK 語音');
    expect(modeStrip(base, 'mock').playback).toBe('MOCK 測試音');
  });
});
