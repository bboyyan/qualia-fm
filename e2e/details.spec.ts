import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, expectNotCoveredByBottomBar, generate, openApp, skipFeedback } from './support';

async function startListening(page: Page): Promise<void> {
  await openApp(page, 'mock');
  await generate(page);
  await page.getByTestId('start-listening').click();
  await page.getByTestId('skip-intro').click();
  await expect(page.getByTestId('phase-label')).toContainText('MOCK 合成測試音播放中', { timeout: 10_000 });
}

const audioPaused = (page: Page) => page.evaluate(() => (document.querySelector('audio') as HTMLAudioElement).paused);
const queueTitles = (page: Page) => page.getByTestId('queue-row').locator('h3').allInnerTexts();

test.describe('T05 收聽與細節', () => {
  test('Bridge sheet explains the pick honestly and does not interrupt playback (AC23)', async ({ page }) => {
    await startListening(page);
    await page.getByTestId('bridge-card').click();
    const sheet = page.getByRole('dialog', { name: '為什麼是這首' });
    await expect(sheet).toContainText('THE BRIDGE · 與起點的連結');
    await expect(sheet).toContainText('這一段的感覺鉤子');
    await expect(sheet).toContainText('歌詞情境');
    await expect(sheet.getByTestId('bridge-evidence')).toContainText('推薦推測，尚未聽音驗證');
    expect(await audioPaused(page)).toBe(false);
    await sheet.getByRole('button', { name: '關閉面板' }).click();
    await expect(page.getByTestId('bridge-card')).toBeFocused();
    expect(await audioPaused(page)).toBe(false);
  });

  test('Queue: current row cannot be removed; remove + undo restores the same order (AC20)', async ({ page }) => {
    await startListening(page);
    await page.getByTestId('count-pill').click();
    const sheet = page.getByTestId('queue-sheet');
    await expect(sheet.getByRole('heading', { name: '這一段 · 5 首' })).toBeVisible();
    const rows = sheet.getByTestId('queue-row');
    await expect(rows.first()).toHaveAttribute('data-status', 'playing');
    await expect(rows.first().getByRole('button', { name: /移除/ })).toHaveCount(0);
    const before = await queueTitles(page);
    await sheet.getByRole('button', { name: '移除 柔焦公路' }).click();
    await expect(sheet.getByRole('heading', { name: '這一段 · 4 首' })).toBeVisible();
    await expect(sheet.getByTestId('toast')).toContainText('已從接下來移除「柔焦公路」');
    await sheet.getByRole('button', { name: '復原' }).click();
    await expect(sheet.getByRole('heading', { name: '這一段 · 5 首' })).toBeVisible();
    expect(await queueTitles(page)).toEqual(before);
    expect(await audioPaused(page)).toBe(false);
  });

  test('Queue: tapping a row does nothing; "現在播放" switches and closes the sheet', async ({ page }) => {
    await startListening(page);
    await page.getByTestId('count-pill').click();
    await page.getByTestId('queue-row').nth(3).locator('h3').click();
    await expect(page.getByTestId('track-title')).toHaveText('微光偏航');
    await page.getByRole('button', { name: '現在播放 低空漂浮' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await skipFeedback(page);
    await expect(page.getByTestId('track-title')).toHaveText('低空漂浮');
  });

  test('removing the next song updates "接下來" and its bridge falls back to the seed bridge (AC21)', async ({ page }) => {
    await startListening(page);
    await page.getByTestId('count-pill').click();
    await page.getByRole('button', { name: '移除 雨後的底片' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('next-up')).toContainText('柔焦公路');
    await page.getByTestId('count-pill').click();
    await expect(page.getByTestId('queue-row').nth(1)).toContainText('TEST 假推薦');
  });

  test('Tune replaces only the upcoming tail and never interrupts the current song (AC22)', async ({ page }) => {
    await startListening(page);
    await page.getByTestId('open-tune').click();
    const sheet = page.getByRole('dialog', { name: '把接下來，調近一點' });
    await expect(sheet).toContainText('不打斷這首');
    await sheet.getByRole('button', { name: 'TEST 微調一' }).click();
    await sheet.getByTestId('tune-apply').click();
    await expect(sheet.getByTestId('tune-running')).toBeVisible();
    expect(await audioPaused(page)).toBe(false);
    await expect(page.getByTestId('toast')).toContainText('已替換接下來的 5 首；這首沒有中斷', { timeout: 8_000 });
    await expect(page.getByTestId('track-title')).toHaveText('微光偏航');
    expect(await audioPaused(page)).toBe(false);
    await expect(page.getByTestId('next-up')).toContainText('紙飛機練習曲');
  });

  test('Tune cancel leaves the queue unchanged (AC22)', async ({ page }) => {
    await startListening(page);
    await page.getByTestId('open-tune').click();
    const sheet = page.getByRole('dialog', { name: '把接下來，調近一點' });
    await sheet.getByTestId('tune-input').fill('TEST fake tuning');
    await sheet.getByTestId('tune-apply').click();
    await sheet.getByTestId('tune-cancel').click();
    await page.waitForTimeout(2_500);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('next-up')).toContainText('雨後的底片');
  });

  test('mini-player appears off the listen tab, controls playback and never covers the nav', async ({ page }) => {
    await startListening(page);
    await expect(page.getByTestId('mini-player')).toHaveCount(0);
    await page.getByTestId('tab-settings').click();
    const mini = page.getByTestId('mini-player');
    await expect(mini).toContainText('微光偏航');
    const miniBox = await mini.boundingBox();
    const navBox = await page.getByRole('navigation', { name: '主要導覽' }).boundingBox();
    expect((miniBox?.y ?? 0) + (miniBox?.height ?? 0)).toBeLessThanOrEqual(navBox?.y ?? 0);
    await page.getByTestId('mini-toggle').click();
    await expect(mini).toContainText('已暫停');
    expect(await audioPaused(page)).toBe(true);
    await expectNotCoveredByBottomBar(page, 'simulate-device-lost');
    await mini.getByRole('button', { name: /返回收聽/ }).click();
    await expect(page.getByTestId('listen-page')).toBeVisible();
  });

  test('building the next show keeps the current one playing until the user switches', async ({ page }) => {
    await startListening(page);
    await page.getByTestId('tab-home').click();
    await expect(page.getByTestId('generate')).toHaveText(/建立下一段/);
    await generate(page, 'TEST fake next seed');
    await expect(page.getByTestId('start-listening')).toHaveText(/現在切換至新節目/);
    expect(await audioPaused(page)).toBe(false);
    await page.getByRole('button', { name: '先回到正在收聽' }).click();
    await expect(page.getByTestId('track-title')).toHaveText('微光偏航');
  });

  test('device loss shows a reconnect action and recovers (AC25)', async ({ page }) => {
    await startListening(page);
    await page.getByTestId('tab-settings').click();
    await page.getByTestId('simulate-device-lost').click();
    await expect(page.getByTestId('playback-error')).toContainText('播放裝置目前未連線');
    await page.getByRole('button', { name: '重新連線' }).click();
    await expect(page.getByTestId('phase-label')).toContainText('MOCK 合成測試音播放中', { timeout: 8_000 });
  });

  test('turning DJ off skips intros from the next segment on', async ({ page }) => {
    await startListening(page);
    await page.getByTestId('tab-settings').click();
    await page.getByRole('switch', { name: 'DJ 介紹' }).click();
    await page.getByTestId('tab-listen').click();
    await page.getByTestId('next').click();
    await skipFeedback(page);
    await expect(page.getByTestId('dj-strip')).toHaveCount(0);
    await expect(page.getByTestId('phase-label')).toContainText('MOCK 合成測試音播放中', { timeout: 8_000 });
  });

  test('320px wide (≈200% zoom of a 640px window): no horizontal overflow and key actions reachable (AC32)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await startListening(page);
    await expectNoHorizontalOverflow(page);
    await expectNotCoveredByBottomBar(page, 'play-toggle');
    await page.getByTestId('count-pill').click();
    await expectNoHorizontalOverflow(page);
    await page.keyboard.press('Escape');
    for (const tab of ['home', 'settings'] as const) {
      await page.getByTestId(`tab-${tab}`).click();
      await expectNoHorizontalOverflow(page);
    }
  });
});
