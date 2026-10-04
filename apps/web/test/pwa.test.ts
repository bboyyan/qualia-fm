import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { vi.stubGlobal('fetch', () => { throw new Error('禁止真實網路'); }); });
it('PWA manifest 使用設計色、standalone、完整圖示，HTML 提供 iPhone 安裝 metadata', () => {
  const manifest = JSON.parse(readFileSync('apps/web/public/manifest.webmanifest', 'utf8'));
  expect(manifest).toMatchObject({ name: 'Qualia FM', short_name: 'Qualia FM', start_url: '/', display: 'standalone', theme_color: '#294F42', background_color: '#F6F4ED' });
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: '192x192', type: 'image/png', purpose: 'any' }),
    expect.objectContaining({ sizes: '512x512', type: 'image/png', purpose: 'any' }),
    expect.objectContaining({ sizes: '512x512', type: 'image/png', purpose: 'maskable' }),
  ]));
  const html = readFileSync('apps/web/index.html', 'utf8');
  for (const value of ['rel="manifest"', 'rel="apple-touch-icon"', 'name="apple-mobile-web-app-capable"', 'name="apple-mobile-web-app-title"', 'name="theme-color"']) expect(html).toContain(value);
});
it('純 Node PNG 腳本可重跑，圖示簽章與尺寸正確，輸出確定性且與已追蹤檔案一致；測試只寫暫存目錄，不改動 public', () => {
  const names = [['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-192.png', 192], ['icon-maskable-512.png', 512], ['apple-touch-icon.png', 180]] as const;
  const tracked = [...names.map(([name]) => name), 'manifest.webmanifest'].map((name) => `apps/web/public/${name}`);
  const before = tracked.map((path) => ({ mtimeMs: statSync(path).mtimeMs, bytes: readFileSync(path) }));
  const generate = () => {
    const dir = mkdtempSync(join(tmpdir(), 'qualia-icons-'));
    execFileSync(process.execPath, ['scripts/generate-icons.mjs', dir]);
    return dir;
  };
  const first = generate();
  const second = generate();
  for (const [name, size] of names) {
    const bytes = readFileSync(join(first, name));
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes.readUInt32BE(16)).toBe(size); expect(bytes.readUInt32BE(20)).toBe(size);
    expect(readFileSync(join(second, name))).toEqual(bytes);
    expect(readFileSync(`apps/web/public/${name}`), name).toEqual(bytes);
  }
  expect(readFileSync(join(first, 'manifest.webmanifest'), 'utf8')).toBe(readFileSync('apps/web/public/manifest.webmanifest', 'utf8'));
  tracked.forEach((path, i) => {
    expect(statSync(path).mtimeMs, path).toBe(before[i]!.mtimeMs);
    expect(readFileSync(path), path).toEqual(before[i]!.bytes);
  });
});
