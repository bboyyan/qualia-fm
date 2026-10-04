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
  await page.getByLabel('一句质地原因（可略過）'.replace('质', '質')).fill('TEST reason');
  await expectNoHorizontalOverflow(page);
  if (['mobile-360', 'mobile-390'].includes(testInfo.project.name)) {
    await form.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `docs/implementation/screenshots/bra98-feedback-${testInfo.project.name === 'mobile-360' ? '360x800' : '390x844'}.png`, scale: 'css' });
  }
  await page.getByRole('button', { name: '送出回饋', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '已記錄至 TEST 假帳本' })).toBeVisible();
  await expect(page.getByTestId('count-pill')).toHaveText('02 / 05');
  await page.getByRole('button', { name: '我開始播了', exact: true }).click();
  await page.getByRole('button', { name: '這首播完了', exact: true }).click();
  await page.getByRole('button', { name: '略過回饋', exact: true }).click();
  await expect(page.getByTestId('count-pill')).toHaveText('03 / 05');
});
