import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

it('workspace engines 與 README 同步支援指定 Node 版本範圍', () => {
  const supported = '^22.13.0 || ^24.0.0 || >=26.0.0';
  expect(JSON.parse(read('package.json')).engines.node).toBe(supported);
  for (const parent of ['apps', 'packages']) {
    for (const name of readdirSync(new URL(`${parent}/`, root))) {
      const pkg = JSON.parse(read(`${parent}/${name}/package.json`));
      if (pkg.engines?.node) expect(pkg.engines.node).toBe(supported);
    }
  }
  expect(read('README.md')).toContain(supported);
  expect(read('README.md')).not.toContain('本機以 v25.5 驗證');
});

it('Spotify 文件反映已交付 B 手動與回饋閉環，E 與兩個 gate 仍停用', () => {
  const doc = read('docs/spotify-playback-and-terms.md');
  for (const stale of ['回饋按鈕尚未實作', '真實語音／回饋尚未完成', '非已存在的本站按鈕', '本站回饋按鈕尚未做', '新增回饋功能另票', 'retarget', 'base 是 `qualia/mvp-t01-t05`', '止於開 PR', '刪分支回滾']) {
    expect(doc).not.toContain(stale);
  }
  expect(doc).toContain('B 手動播放模式與回饋閉環已實作');
  expect(doc).toContain('E 模式仍停用');
  expect(doc).toContain('`SPOTIFY_ENABLED` 與 `SPOTIFY_DJ_APPROVED` 維持 `false`');
});
