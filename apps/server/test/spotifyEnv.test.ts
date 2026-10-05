import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigError, loadConfig } from '../src/config/env.js';
import { assertFeatureAllowed, buildCapabilities, MOCK_RESTRICTIONS } from '../src/services/capabilities.js';
import { SPOTIFY_TEST_ENV } from './spotifyHelpers.js';

beforeEach(() => { vi.stubGlobal('fetch', () => { throw new Error('禁止真實網路'); }); });

const errorOf = (env: Record<string, string>): string => {
  try {
    loadConfig(env);
  } catch (error: unknown) {
    if (error instanceof ConfigError) return error.message;
    throw error;
  }
  return '';
};

describe('Spotify 開關：預設全關，與現況相同', () => {
  it('env 未設時兩個 gate 都是 false、capabilities 不帶 spotify 欄位且限制文案不變', () => {
    const config = loadConfig({});
    expect(config.gates).toEqual({ spotifyEnabled: false, spotifyDjApproved: false });
    const caps = buildCapabilities(config);
    expect(caps).not.toHaveProperty('spotify');
    expect(caps.restrictions).toEqual([...MOCK_RESTRICTIONS]);
  });

  it('空字串視同未設定（.env.example 的寫法）', () => {
    const config = loadConfig({ SPOTIFY_ENABLED: '', SPOTIFY_CLIENT_ID: '', SPOTIFY_REDIRECT_URI: '', SPOTIFY_TOKEN_ENC_KEY: '', SPOTIFY_APPROVAL_REFERENCE: '' });
    expect(config.gates).toEqual({ spotifyEnabled: false, spotifyDjApproved: false });
  });

  it('預設 Loved 歌單 ID 為 Qualia Loved，可由 env 覆寫且格式要正確', () => {
    expect(loadConfig({}).spotify.lovedPlaylistId).toBe('0dF9anAJZv0IotD6lo2kl2');
    expect(loadConfig({ SPOTIFY_LOVED_PLAYLIST_ID: 'AAAAAAAAAAAAAAAAAAAAAA' }).spotify.lovedPlaylistId).toBe('AAAAAAAAAAAAAAAAAAAAAA');
    expect(() => loadConfig({ SPOTIFY_LOVED_PLAYLIST_ID: 'not/a/playlist' })).toThrow(ConfigError);
  });
});

describe('SPOTIFY_ENABLED=true 嚴格閘門（fail closed）', () => {
  it('三項齊全才可啟動；DJ 仍為 false', () => {
    const config = loadConfig({ ...SPOTIFY_TEST_ENV });
    expect(config.gates).toEqual({ spotifyEnabled: true, spotifyDjApproved: false });
    expect(config.spotify.clientId).toBe(SPOTIFY_TEST_ENV.SPOTIFY_CLIENT_ID);
    expect(config.spotify.redirectUri).toBe(SPOTIFY_TEST_ENV.SPOTIFY_REDIRECT_URI);
    expect(config.spotify.tokenKey?.length).toBe(32);
  });

  it.each(['SPOTIFY_CLIENT_ID', 'SPOTIFY_REDIRECT_URI', 'SPOTIFY_TOKEN_ENC_KEY'])('缺 %s 拒絕啟動，訊息點名變數', (name) => {
    const env: Record<string, string> = { ...SPOTIFY_TEST_ENV, [name]: '' };
    expect(errorOf(env)).toContain(name);
  });

  it('金鑰必須解碼成 32 bytes（base64 或 hex），錯誤訊息不含金鑰值', () => {
    const shortKey = randomBytes(16).toString('base64');
    const message = errorOf({ ...SPOTIFY_TEST_ENV, SPOTIFY_TOKEN_ENC_KEY: shortKey });
    expect(message).toContain('SPOTIFY_TOKEN_ENC_KEY');
    expect(message).not.toContain(shortKey);
    expect(loadConfig({ ...SPOTIFY_TEST_ENV, SPOTIFY_TOKEN_ENC_KEY: randomBytes(32).toString('hex') }).spotify.tokenKey?.length).toBe(32);
  });

  it.each([
    'http://qualia.example.test/callback',
    'https://localhost:10000/callback',
    'http://localhost:5173/callback',
    'https://qualia.example.test/other',
    'not a url',
  ])('redirect URI %s 不被接受（需 HTTPS 或明確 loopback IP，且路徑為本服務處理的回呼）', (uri) => {
    expect(errorOf({ ...SPOTIFY_TEST_ENV, SPOTIFY_REDIRECT_URI: uri })).toContain('SPOTIFY_REDIRECT_URI');
  });

  it.each(['https://jaxpkmmac-mini.example.ts.net:10000/callback', 'https://qualia.example.test/api/auth/spotify/callback', 'http://127.0.0.1:8080/callback'])(
    '接受 %s',
    (uri) => {
      expect(loadConfig({ ...SPOTIFY_TEST_ENV, SPOTIFY_REDIRECT_URI: uri }).spotify.redirectUri).toBe(uri);
    },
  );

  it('Client ID 只來自 env，程式沒有預設值', () => {
    expect(loadConfig({}).spotify.clientId).toBeUndefined();
  });

  it('capabilities 反映已啟用但尚未連結，限制文案不再說 Spotify 尚未啟用', () => {
    const caps = buildCapabilities(loadConfig({ ...SPOTIFY_TEST_ENV }), null, { linked: false });
    expect(caps.spotifyEnabled).toBe(true);
    expect(caps.spotifyDjApproved).toBe(false);
    expect(caps.spotify).toMatchObject({ linked: false, lovedPlaylistId: '0dF9anAJZv0IotD6lo2kl2', clientId: SPOTIFY_TEST_ENV.SPOTIFY_CLIENT_ID });
    // 鎖定白名單（不引用常數）：多一個或少一個 scope 都要讓測試失敗。
    expect(caps.spotify?.scopes).toEqual(['streaming', 'user-read-email', 'user-read-private', 'user-read-playback-state', 'user-modify-playback-state', 'playlist-modify-private', 'playlist-read-private']);
    expect(caps.restrictions.join('\n')).not.toContain('Spotify 尚未啟用');
  });
});

describe('SPOTIFY_DJ_APPROVED=true 需要 ENABLED 與可追溯核可依據', () => {
  it('ENABLED＋非空 reference 才開啟 E 模式', () => {
    const config = loadConfig({ ...SPOTIFY_TEST_ENV, SPOTIFY_DJ_APPROVED: 'true', SPOTIFY_APPROVAL_REFERENCE: 'BRA-109 TEST 2026-10-05' });
    expect(config.gates).toEqual({ spotifyEnabled: true, spotifyDjApproved: true });
  });

  it.each(['', '   '])('reference 為空（%j）拒絕啟動', (reference) => {
    expect(errorOf({ ...SPOTIFY_TEST_ENV, SPOTIFY_DJ_APPROVED: 'true', SPOTIFY_APPROVAL_REFERENCE: reference })).toContain('SPOTIFY_APPROVAL_REFERENCE');
  });

  it('沒有 ENABLED 時即使有 reference 也拒絕啟動', () => {
    expect(errorOf({ SPOTIFY_DJ_APPROVED: 'true', SPOTIFY_APPROVAL_REFERENCE: 'BRA-109 TEST' })).toContain('SPOTIFY_ENABLED');
  });
});

describe('.env.example 維持關閉、不含金鑰', () => {
  it('Spotify 值一律留空或 false；Client ID 只出現在註解示例', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
    const values = Object.fromEntries(text.split('\n').filter((line) => /^SPOTIFY_[A-Z_]+=/.test(line)).map((line) => line.split(/=(.*)/s).slice(0, 2) as [string, string]));
    expect(values).toEqual({
      SPOTIFY_ENABLED: 'false',
      SPOTIFY_DJ_APPROVED: 'false',
      SPOTIFY_APPROVAL_REFERENCE: '',
      SPOTIFY_CLIENT_ID: '',
      SPOTIFY_REDIRECT_URI: '',
      SPOTIFY_TOKEN_ENC_KEY: '',
      SPOTIFY_TOKEN_FILE: '',
      SPOTIFY_LOVED_PLAYLIST_ID: '',
    });
    for (const line of text.split('\n').filter((l) => l.includes('643a3f074bd74c039161010453a7e56f'))) expect(line.startsWith('#')).toBe(true);
  });

  it('程式碼裡沒有寫死 Qualia FM 的 Client ID', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
    const roots = ['apps/server/src', 'apps/web/src', 'packages/contracts/src'];
    const hits = roots.flatMap(walk).filter((file) => readFileSync(file, 'utf8').includes('643a3f074bd74c039161010453a7e56f'));
    expect(hits).toEqual([]);
  });
});

describe('mutation 補測（BRA-111 重跑 PR #6）', () => {
  it('S28：E 模式 gate 在執行期也要求 SPOTIFY_ENABLED（不只靠啟動檢查）', () => {
    const base = loadConfig({});
    const djOnly = { ...base, gates: { spotifyEnabled: false, spotifyDjApproved: true } };
    expect(() => assertFeatureAllowed(djOnly, 'spotify_dj')).toThrow();
    const both = { ...base, gates: { spotifyEnabled: true, spotifyDjApproved: true } };
    expect(() => assertFeatureAllowed(both, 'spotify_dj')).not.toThrow();
  });
});

describe('SPOTIFY_OWNER_USER_ID（BRA-111 審查必修）', () => {
  it('預設未設定；SPOTIFY_ENABLED=true 時仍可啟動（連結會被拒絕）', () => {
    expect(loadConfig({}).spotify.ownerUserId).toBeUndefined();
    const { SPOTIFY_OWNER_USER_ID: _unset, ...env } = SPOTIFY_TEST_ENV;
    expect(loadConfig(env).spotify.ownerUserId).toBeUndefined();
  });

  it('設定後原樣讀入（區分大小寫）', () => {
    expect(loadConfig({ ...SPOTIFY_TEST_ENV, SPOTIFY_OWNER_USER_ID: 'TESTowner.Name_1' }).spotify.ownerUserId).toBe('TESTowner.Name_1');
  });

  it('啟用時格式明顯錯誤（空白、斜線）→ 拒絕啟動，只點名變數、不回顯值', () => {
    const message = errorOf({ ...SPOTIFY_TEST_ENV, SPOTIFY_OWNER_USER_ID: 'bad id/with space' });
    expect(message).toContain('SPOTIFY_OWNER_USER_ID');
    expect(message).not.toContain('bad id');
  });
});

