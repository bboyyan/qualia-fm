import { cpSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { beforeEach, expect, it, vi } from 'vitest';
import { testApp } from './helpers.js';

beforeEach(() => { vi.stubGlobal('fetch', () => { throw new Error('禁止真實網路'); }); });
it('靜態 manifest 與 PNG MIME 正確且保留 CSP 與安全標頭', async () => {
  const staticDir = mkdtempSync(join(tmpdir(), 'qualia-pwa-'));
  cpSync('apps/web/public', staticDir, { recursive: true });
  copyFileSync('apps/web/index.html', join(staticDir, 'index.html'));
  const { app } = testApp({ STATIC_DIR: staticDir });
  for (const [path, mime] of [['/manifest.webmanifest', 'application/manifest+json'], ['/icon-192.png', 'image/png']]) {
    const res = await request(app).get(path!).expect(200);
    expect(res.headers['content-type']).toContain(mime);
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  }
});
