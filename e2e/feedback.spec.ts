import { stat } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, generate, openApp } from './support';

test('B default, E disabled, manual finish shows feedback and submission advances', async ({ page }, testInfo) => {
  await openApp(page);
  await page.getByTestId('tab-settings').click();
  await expect(page.getByRole('radio', { name: 'B · 手動（預設）' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'E · Spotify 自動串接' })).toBeDisabled();
  await expect(page.getByText('需曄當次明確同意，預設關閉', { exact: true })).toBeVisible();
  await page.getByTestId('tab-home').click();
  await generate(page, 'TEST seed');
  await page.getByTestId('start-listening').click();
  await page.getByRole('button', { name: '我開始播了', exact: true }).click();
  await expect(page.getByText('外部播放中（由你確認）', { exact: true })).toBeVisible();
  expect(await page.locator('audio').evaluateAll((els) => els.every((el) => (el as HTMLAudioElement).paused))).toBe(true);
  await page.getByRole('button', { name: '這首播完了', exact: true }).click();
  const form = page.getByRole('region', { name: '這首的回饋' });
  for (const name of ['愛', '還行', '不對']) await expect(form.getByRole('button', { name, exact: true })).toBeVisible();
  await form.getByRole('button', { name: '愛', exact: true }).click();
  await page.getByLabel('一句質地原因（可略過）').fill('TEST reason');
  await page.getByTestId('tab-settings').click();
  await expect(page.getByRole('radio', { name: 'B · 手動（預設）', exact: true })).toBeDisabled();
  await page.getByTestId('tab-listen').click();
  await expect(form.getByRole('button', { name: '愛', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('一句質地原因（可略過）')).toHaveValue('TEST reason');
  await expectNoHorizontalOverflow(page);
  if (['mobile-360', 'mobile-390'].includes(testInfo.project.name)) {
    await form.scrollIntoViewIfNeeded();
    const path = `docs/implementation/screenshots/bra98-feedback-${testInfo.project.name === 'mobile-360' ? '360x800' : '390x844'}.png`;
    await page.screenshot({ path, scale: 'css' });
    expect((await stat(path)).size).toBeLessThan(300 * 1024);
  }
  await page.getByRole('button', { name: '送出回饋', exact: true }).click();
  await expect(page.getByTestId('toast').first()).toContainText('已記錄至 TEST 假帳本');
  await expect(page.getByTestId('count-pill')).toHaveText('02 / 05');
  await page.getByRole('button', { name: '我開始播了', exact: true }).click();
  await page.getByRole('button', { name: '這首播完了', exact: true }).click();
  await page.getByRole('button', { name: '略過回饋', exact: true }).click();
  await expect(page.getByTestId('count-pill')).toHaveText('03 / 05');
});

test('V4 warning is visible in ready and listen views when show reports ledger failure', async ({ page }) => {
  await page.route('**/api/shows/*', async (route) => {
    const response = await route.fetch();
    const show = await response.json();
    await route.fulfill({ response, json: { ...show, warnings: [...show.warnings, '未讀到帳本：本輪只用種子曲。'] } });
  });
  await openApp(page);
  await generate(page, 'TEST seed');
  await expect(page.getByTestId('ledger-warning')).toContainText('未讀到帳本');
  await page.getByTestId('start-listening').click();
  await expect(page.getByTestId('ledger-warning')).toContainText('本輪只用種子曲');
});

test('B skip asks feedback; save failure preserves inputs, retry sends an empty reason', async ({ page }) => {
  let attempts = 0;
  const bodies: unknown[] = [];
  await page.route('**/api/feedback', async (route) => {
    attempts += 1;
    bodies.push(route.request().postDataJSON());
    if (attempts === 1) await route.fulfill({ status: 503, json: { error: 'TEST unavailable' } });
    else await route.continue();
  });
  await openApp(page);
  await generate(page, 'TEST seed');
  await page.getByTestId('start-listening').click();
  await page.getByRole('button', { name: '我開始播了', exact: true }).click();
  await page.getByRole('button', { name: '跳過這首', exact: true }).click();
  const form = page.getByTestId('feedback-card');
  await form.getByRole('button', { name: '還行', exact: true }).click();
  await form.getByRole('button', { name: '送出回饋', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('內容已保留');
  await expect(form.getByRole('button', { name: '還行', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('count-pill')).toHaveText('01 / 05');
  await form.getByRole('button', { name: '送出回饋', exact: true }).click();
  await expect(page.getByTestId('count-pill')).toHaveText('02 / 05');
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toMatchObject({ rating: '還行', reason: '' });
});

test('settings switch B to mock and back without enabling E; selection persists', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('tab-settings').click();
  await page.getByRole('radio', { name: 'MOCK · 合成測試音', exact: true }).check();
  await page.reload();
  await page.getByTestId('tab-settings').click();
  await expect(page.getByRole('radio', { name: 'MOCK · 合成測試音', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: 'B · 手動（預設）', exact: true }).check();
  await expect(page.getByRole('radio', { name: 'B · 手動（預設）', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'E · Spotify 自動串接', exact: true })).toBeDisabled();
});
