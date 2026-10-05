import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('dev 預設帳本與暫存檔不會被一般 git add 收入索引', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'qualia-taste-privacy-')));
  try {
    const server = join(root, 'apps/server');
    mkdirSync(server, { recursive: true });
    copyFileSync(new URL('../../../.gitignore', import.meta.url), join(root, '.gitignore'));
    const configUrl = new URL('../src/config/env.ts', import.meta.url).href;
    const path = execFileSync(process.execPath, [
      '--import', import.meta.resolve('tsx'), '--conditions=source', '--input-type=module', '-e',
      `import { loadConfig } from ${JSON.stringify(configUrl)}; console.log(loadConfig({ NODE_ENV: 'development' }).tasteLedger.path);`,
    ], { cwd: server, encoding: 'utf8' }).trim();
    expect(path).toBe(join(server, 'data/taste-ledger.json'));
    mkdirSync(join(server, 'data'));
    writeFileSync(path, 'TEST private ledger');
    writeFileSync(`${path}.TEST.tmp`, 'TEST private temporary ledger');
    writeFileSync(join(root, 'control.txt'), 'TEST tracked control');
    const git = (...args: string[]) => execFileSync('git', ['-c', 'core.excludesFile=/dev/null', ...args], { cwd: root, encoding: 'utf8' });
    git('init', '--quiet');
    git('add', '.');
    expect(git('ls-files').trim().split('\n')).toEqual(['.gitignore', 'control.txt']);
    expect(git('check-ignore', 'apps/server/data/taste-ledger.json').trim()).toBe('apps/server/data/taste-ledger.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
