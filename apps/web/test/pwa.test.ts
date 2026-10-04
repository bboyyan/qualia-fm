import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
it('純 Node PNG 腳本可重跑，圖示簽章與尺寸正確，輸出確定性', () => {
  execFileSync(process.execPath, ['scripts/generate-icons.mjs']);
  const names = [['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-192.png', 192], ['icon-maskable-512.png', 512], ['apple-touch-icon.png', 180]] as const;
  const first = names.map(([name, size]) => {
    const bytes = readFileSync(`apps/web/public/${name}`);
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes.readUInt32BE(16)).toBe(size); expect(bytes.readUInt32BE(20)).toBe(size);
    return bytes;
  });
  execFileSync(process.execPath, ['scripts/generate-icons.mjs']);
  names.forEach(([name], i) => expect(readFileSync(`apps/web/public/${name}`)).toEqual(first[i]));
});
