import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { generate, openApp } from './support';

/** Dedicated mock-only process: never kickstart or touch the real-test launchctl service. */
async function freePort(): Promise<number> {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('TEST missing port');
  const port = address.port;
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
}

test('BRA-161 V1：收聽中真實程序重啟，原頁面回饋 201 並寫入磁碟帳本', async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), 'qfm-restart-e2e-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const ledgerPath = join(dir, 'taste.json');
  let child: ChildProcess | undefined;
  const start = async () => {
    child = spawn(process.execPath, ['apps/server/dist/index.js'], {
      cwd: resolve('.'), stdio: 'ignore',
      env: {
        NODE_ENV: 'test', PORT: String(port), APP_ORIGIN: origin,
        PROVIDER_MODE: 'mock', LLM_PROVIDER: 'mock', TTS_PROVIDER: 'mock',
        SPOTIFY_ENABLED: 'false', SPOTIFY_DJ_APPROVED: 'false', OPENAI_REAL_CALLS_APPROVED: 'false',
        STATIC_DIR: resolve('apps/web/dist'), SESSION_STORE_PATH: join(dir, 'sessions.json'),
        TASTE_LEDGER_PATH: ledgerPath, MOCK_PHASE_MS: '20',
      },
    });
    await expect.poll(async () => {
      try { return (await page.request.get(`${origin}/api/health`)).status(); }
      catch { return 0; }
    }).toBe(200);
  };
  try {
    await start();
    await page.goto(`${origin}/?developer=1`);
    await generate(page, 'TEST restart');
    await page.getByTestId('start-listening').click();
    await page.getByRole('button', { name: '我開始播了', exact: true }).click();
    await page.getByRole('button', { name: '這首播完了', exact: true }).click();
    const form = page.getByTestId('feedback-card');
    await form.getByRole('button', { name: '愛', exact: true }).click();
    await page.getByLabel('一句質地原因（可略過）').fill('TEST restart kept');
    const before = (await page.context().cookies(origin)).find((cookie) => cookie.name === 'qfm_sid');
    expect(before).toBeDefined();
    await stop(child!);
    await start();
    const response = page.waitForResponse((res) => res.url() === `${origin}/api/feedback`);
    await form.getByRole('button', { name: '送出回饋', exact: true }).click();
    expect((await response).status()).toBe(201);
    await expect(page.getByTestId('count-pill')).toHaveText('02 / 05');
    expect((await page.context().cookies(origin)).find((cookie) => cookie.name === 'qfm_sid')?.value).toBe(before?.value);
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) as { entries: { kind: string; rating?: string; note?: string }[] };
    expect(ledger.entries.filter((entry) => entry.kind === 'feedback')).toEqual([expect.objectContaining({ rating: '愛', note: 'TEST restart kept' })]);
  } finally {
    if (child) await stop(child);
    await rm(dir, { recursive: true, force: true });
  }
});

const expired = { error: { code: 'SESSION_EXPIRED', message: '工作階段已過期', retryable: true, requestId: 'TEST-e2e-expired', retryAfterMs: null } };

test('BRA-161 V2：401 恢復 session 原樣重送成功且可讀 ledger', async ({ page }) => {
  await openApp(page);
  await generate(page, 'TEST recovery');
  await page.getByTestId('start-listening').click();
  await page.getByRole('button', { name: '我開始播了', exact: true }).click();
  await page.getByRole('button', { name: '這首播完了', exact: true }).click();
  let attempts = 0;
  let sessions = 0;
  const bodies: unknown[] = [];
  page.on('request', (request) => { if (request.url().endsWith('/api/session')) sessions += 1; });
  await page.route('**/api/feedback', async (route) => {
    bodies.push(route.request().postDataJSON());
    if (++attempts === 1) await route.fulfill({ status: 401, json: expired });
    else await route.continue();
  });
  const form = page.getByTestId('feedback-card');
  await form.getByRole('button', { name: '還行', exact: true }).click();
  await page.getByLabel('一句質地原因（可略過）').fill('TEST recovered E2E');
  await form.getByRole('button', { name: '送出回饋', exact: true }).click();
  await expect(page.getByTestId('count-pill')).toHaveText('02 / 05');
  expect(attempts).toBe(2);
  expect(sessions).toBe(1);
  expect(bodies[0]).toEqual(bodies[1]);
  const response = await page.request.get('/api/taste/marks');
  expect(response.status()).toBe(200);
  expect((await response.json()).marks).toContainEqual(expect.objectContaining({ rating: '還行', note: 'TEST recovered E2E' }));
});

test('BRA-161 V2：連續 SESSION_EXPIRED 停在兩次，保留輸入並顯示重試入口', async ({ page }) => {
  await openApp(page);
  await generate(page, 'TEST bounded');
  await page.getByTestId('start-listening').click();
  await page.getByRole('button', { name: '我開始播了', exact: true }).click();
  await page.getByRole('button', { name: '這首播完了', exact: true }).click();
  let attempts = 0;
  let sessions = 0;
  page.on('request', (request) => { if (request.url().endsWith('/api/session')) sessions += 1; });
  await page.route('**/api/feedback', async (route) => { attempts += 1; await route.fulfill({ status: 401, json: expired }); });
  const form = page.getByTestId('feedback-card');
  await form.getByRole('button', { name: '不對', exact: true }).click();
  await page.getByLabel('一句質地原因（可略過）').fill('TEST bounded kept');
  await form.getByRole('button', { name: '送出回饋', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('內容已保留');
  await expect(form.getByRole('button', { name: '送出回饋', exact: true })).toBeEnabled();
  await expect(form.getByRole('button', { name: '不對', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('一句質地原因（可略過）')).toHaveValue('TEST bounded kept');
  await expect(page.getByTestId('count-pill')).toHaveText('01 / 05');
  expect(attempts).toBe(2);
  expect(sessions).toBe(1);
});
