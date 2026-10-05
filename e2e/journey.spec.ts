/**
 * BRA-128：種子＝1 顆寶石，聽完／回饋鑲嵌，滿 5 顆在收聽頁首屏的小寶石盤提示，打開即見旅程膠囊。
 */
import { stat } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, generate, openApp, skipFeedback } from './support';

test('種子＋4 首聽完／回饋 → 開出旅程膠囊（曲目、情緒標籤、更長結語）', async ({ page }, testInfo) => {
  await openApp(page);
  await generate(page, '下雨的深夜，一個人走回家');
  await page.getByTestId('start-listening').click();
  const tray = page.getByTestId('gem-tray');
  await expect(tray).toHaveAttribute('data-gems', '1');
  await expect(tray).toHaveAccessibleName('旅程寶石 1／5，查看旅程');
  await expectNoHorizontalOverflow(page);

  // 第 1 首：聽完並留下「愛」；第 2–4 首：聽完、略過回饋。
  await page.getByRole('button', { name: '我開始播了', exact: true }).click();
  await page.getByRole('button', { name: '這首播完了', exact: true }).click();
  await expect(tray).toHaveAttribute('data-gems', '2');
  const form = page.getByRole('region', { name: '這首的回饋' });
  await form.getByRole('button', { name: '愛', exact: true }).click();
  await page.getByRole('button', { name: '送出回饋', exact: true }).click();
  await expect(page.getByTestId('count-pill')).toHaveText('02 / 05');
  await expect(tray).toHaveAttribute('data-gems', '2');
  for (let n = 3; n <= 5; n += 1) {
    await page.getByRole('button', { name: '我開始播了', exact: true }).click();
    await page.getByRole('button', { name: '這首播完了', exact: true }).click();
    await skipFeedback(page);
  }

  await expect(tray).toHaveAccessibleName('旅程膠囊開好了，打開');
  await expectNoHorizontalOverflow(page);
  if (['mobile-360', 'mobile-390'].includes(testInfo.project.name)) {
    const size = testInfo.project.name === 'mobile-360' ? '360x800' : '390x844';
    const path = `docs/implementation/screenshots/bra128-tray-ready-${size}.png`;
    await page.screenshot({ path, scale: 'css', animations: 'disabled' });
    expect((await stat(path)).size).toBeLessThan(300 * 1024);
  }

  await tray.click();
  const sheet = page.getByTestId('capsule-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('capsule-tracks').getByRole('listitem')).toHaveCount(4);
  await expect(sheet.getByTestId('capsule-tags').getByRole('listitem').first()).toBeVisible();
  await expect(sheet.getByTestId('capsule-outro')).toContainText('下雨的深夜');
  expect((await sheet.getByTestId('capsule-outro').innerText()).length).toBeGreaterThan(180);
  await expect(sheet.getByLabel('愛', { exact: true })).toBeVisible();
  await expect(sheet.getByTestId('journey-progress')).toContainText('還差 5 顆');
  if (['mobile-360', 'mobile-390'].includes(testInfo.project.name)) {
    const size = testInfo.project.name === 'mobile-360' ? '360x800' : '390x844';
    const path = `docs/implementation/screenshots/bra128-capsule-${size}.png`;
    await page.screenshot({ path, scale: 'css', animations: 'disabled' });
    expect((await stat(path)).size).toBeLessThan(300 * 1024);
  }
  await page.keyboard.press('Escape');
  await expect(tray).toHaveAccessibleName('旅程寶石 0／5，查看旅程');
});
