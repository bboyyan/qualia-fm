import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SpotifyTokenStore } from '../src/spotify/tokenStore.js';

const REFRESH = 'TEST-refresh-token-not-real-0123456789';

function setup(key: Buffer | null = randomBytes(32)) {
  const dir = mkdtempSync(join(tmpdir(), 'qualia-spotify-token-'));
  const file = join(dir, 'spotify-token.enc');
  return { file, key, store: new SpotifyTokenStore(file, key ?? undefined) };
}

describe('SpotifyTokenStore（AES-256-GCM 本機小檔）', () => {
  it('存入後可讀回；檔案權限 600，內容不含明文 token', () => {
    const { file, store } = setup();
    store.save({ refreshToken: REFRESH, scope: 'streaming' });
    expect(store.load()).toEqual({ refreshToken: REFRESH, scope: 'streaming' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).not.toContain(REFRESH);
  });

  it('既有檔案權限過寬時，覆寫後收緊為 600', () => {
    const { file, store } = setup();
    writeFileSync(file, 'old');
    chmodSync(file, 0o644);
    store.save({ refreshToken: REFRESH, scope: 'streaming' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('缺金鑰時 fail closed：拒絕存入、不建立檔案、讀取一律視為未連結', () => {
    const { file, store } = setup(null);
    expect(() => store.save({ refreshToken: REFRESH, scope: 'streaming' })).toThrow(/SPOTIFY_TOKEN_ENC_KEY/);
    expect(existsSync(file)).toBe(false);
    expect(store.load()).toBeNull();
  });

  it('金鑰長度不對也 fail closed', () => {
    const { file } = setup();
    expect(() => new SpotifyTokenStore(file, randomBytes(16)).save({ refreshToken: REFRESH, scope: '' })).toThrow();
    expect(existsSync(file)).toBe(false);
  });

  it('檔案被竄改或換了金鑰：讀取回 null，不丟例外', () => {
    const { file, store } = setup();
    store.save({ refreshToken: REFRESH, scope: 'streaming' });
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { data: string };
    writeFileSync(file, JSON.stringify({ ...raw, data: Buffer.from('tampered').toString('base64') }));
    expect(store.load()).toBeNull();
    const second = setup();
    second.store.save({ refreshToken: REFRESH, scope: 'streaming' });
    expect(new SpotifyTokenStore(second.file, randomBytes(32)).load()).toBeNull();
  });

  it('clear 刪除檔案；檔案不存在時也不報錯', () => {
    const { file, store } = setup();
    store.save({ refreshToken: REFRESH, scope: 'streaming' });
    store.clear();
    expect(existsSync(file)).toBe(false);
    expect(() => store.clear()).not.toThrow();
    expect(store.load()).toBeNull();
  });
});
