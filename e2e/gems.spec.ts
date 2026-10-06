/**
 * BRA-169 V4：五首聽完 → 結算五張背面牌 → 全部翻開才可選 → 選 1 首成為寶石 → 寶石牆顯示（進度＋收藏數）。
 * 同一台伺服器的寶石牆跨 spec 累積，斷言一律相對於開始時的 total。截圖只寫 test-results（BRA-155）。
 */
import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, expectOnFirstScreen, generate, openApp, skipFeedback } from './support';

interface WallSnapshot {
  total: number;
  current: { no: number; gems: { title: string }[] };
}

async function wallOf(page: Page): Promise<WallSnapshot> {
  const res = await page.request.get('/api/gems');
  expect(res.ok()).toBe(true);
  return (await res.json()) as WallSnapshot;
}

async function listenToFive(page: Page): Promise<void> {
  await generate(page, '剛練完舞，累但很爽');
  await page.getByTestId('start-listening').click();
  for (let n = 1; n <= 5; n += 1) {
    await page.getByRole('button', { name: '我開始播了', exact: true }).click();
    await page.getByRole('button', { name: '這首播完了', exact: true }).click();
    await skipFeedback(page);
  }
}

test('V4：結算翻牌 → 全部翻開才可選 → 選寶石 → 寶石牆顯示', async ({ page }, testInfo) => {
  await openApp(page);
  const entry = page.getByTestId('gem-wall-entry');
  await expect(entry).toBeVisible();
  await expectOnFirstScreen(page, 'gem-wall-entry');
  const before = await wallOf(page);
  await expect(entry).toHaveAttribute('data-gems', String(before.current.gems.length));

  await listenToFive(page);

  // ── 結算層：五張背面牌，曲名不外露；未全翻開不可選。
  const overlay = page.getByTestId('settle-overlay');
  await expect(overlay).toBeVisible();
  const panel = overlay.getByTestId('settle-panel');
  const hidden = panel.locator('[data-card-state="hidden"]');
  await expect(hidden).toHaveCount(5);
  const confirm = panel.getByTestId('settle-confirm');
  await expect(confirm).toBeDisabled();
  await expect(confirm).toHaveText('還有 5 張沒翻開');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath(`bra169-settle-hidden-${testInfo.project.name}.png`), animations: 'disabled' });

  for (let opened = 1; opened <= 4; opened += 1) {
    await panel.getByRole('button', { name: /背面朝上，翻開$/ }).first().click();
    await expect(hidden).toHaveCount(5 - opened);
  }
  // 翻了四張：已翻開的牌不能選，確認鈕仍停用。
  await expect(panel.getByRole('button', { name: /^選〈/ })).toHaveCount(0);
  await expect(confirm).toBeDisabled();
  await expect(confirm).toHaveText('還有 1 張沒翻開');

  await panel.getByRole('button', { name: /背面朝上，翻開$/ }).click();
  await expect(hidden).toHaveCount(0);
  const choices = panel.getByRole('button', { name: /^選〈/ });
  await expect(choices).toHaveCount(5);
  await expect(confirm).toHaveText('選一首留成寶石');
  await expect(confirm).toBeDisabled();

  const third = choices.nth(2);
  const title = ((await third.getAttribute('aria-label')) ?? '').replace(/^選〈|〉$/g, '');
  expect(title.length).toBeGreaterThan(0);
  await third.click();
  await expect(third).toHaveAttribute('aria-pressed', 'true');
  await expect(confirm).toBeEnabled();
  await expect(confirm).toHaveText(`把〈${title}〉留成寶石`);
  await page.screenshot({ path: testInfo.outputPath(`bra169-settle-picked-${testInfo.project.name}.png`), animations: 'disabled' });
  await confirm.click();

  const chosen = panel.getByTestId('settle-chosen');
  await expect(chosen).toContainText(`「${title}」成為你的第 ${before.total + 1} 顆寶石。`);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath(`bra169-settle-chosen-${testInfo.project.name}.png`), animations: 'disabled' });

  // ── 收進寶石牆：「我的」tab 的寶石牆頁顯示這顆、進度與收藏數。
  await chosen.getByTestId('settle-to-wall').click();
  await expect(overlay).toBeHidden();
  const wallPage = page.getByTestId('gem-wall');
  await expect(wallPage).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: '寶石牆' })).toBeVisible();
  const after = await wallOf(page);
  expect(after.total).toBe(before.total + 1);
  const count = after.current.gems.length;
  await expect(wallPage.getByTestId('gem-wall-progress')).toContainText(`${count} / 5`);
  await expect(wallPage.getByRole('definition').first()).toHaveText(String(after.total));
  if (count > 0) await expect(wallPage.getByTestId('gem-list')).toContainText(title);
  else await expect(wallPage.getByTestId('gem-shelf')).toContainText(title);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath(`bra169-gem-wall-${testInfo.project.name}.png`), fullPage: true, animations: 'disabled' });

  // ── 回收聽頁：結算不再自動蓋上；節目結束卡改提示「這趟的寶石」。
  await page.getByTestId('tab-listen').click();
  await expect(overlay).toBeHidden();
  await expect(page.getByTestId('settle-reminder')).toContainText(title);

  // ── 首屏入口條跟著更新。
  await page.getByTestId('tab-home').click();
  await expect(entry).toHaveAttribute('data-gems', String(count));
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath(`bra169-home-entry-${testInfo.project.name}.png`), animations: 'disabled' });
});

test('關掉結算層不遺失翻牌進度，節目結束卡可以回去翻', async ({ page }) => {
  await openApp(page);
  await listenToFive(page);
  const overlay = page.getByTestId('settle-overlay');
  await expect(overlay).toBeVisible();
  await overlay.getByRole('button', { name: /背面朝上，翻開$/ }).first().click();
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
  await page.getByTestId('settle-reminder').click();
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('[data-card-state="hidden"]')).toHaveCount(4);
});
