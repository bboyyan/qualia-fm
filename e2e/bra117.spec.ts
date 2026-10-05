/**
 * BRA-117：種子清單全選快速開台、Ready 同一套勾選清單、引言後不提早回饋、迷你播放器回饋態。
 * 全部是 MOCK 與假資料，不呼叫 Spotify／OpenAI／Notion。
 */
import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, openApp } from './support';

test.describe('BRA-117', () => {
  test('開台預設歌曲模式＋預設種子卡；全選一鍵開台；Ready 同一套勾選清單，只播勾選的', async ({ page }) => {
    await openApp(page, 'mock');
    await expect(page.getByRole('radio', { name: '歌曲', exact: true })).toHaveAttribute('aria-checked', 'true');
    const seeds = page.getByTestId('seed-list');
    await expect(seeds).toContainText('預設種子・可更換');
    await expect(seeds).toContainText('Time Flows Ever Onward');
    await expect(seeds).toContainText('Evan Call');
    await expect(page.getByTestId('generate')).toHaveText(/全選・快速開台/);
    await expectNoHorizontalOverflow(page);
    await page.getByTestId('generate').click();
    const ready = page.getByTestId('ready-tracks');
    await expect(ready.getByRole('checkbox')).toHaveCount(5);
    for (const box of await ready.getByRole('checkbox').all()) await expect(box).toBeChecked();
    await expect(page.getByTestId('start-listening')).toHaveText(/全選・開始收聽/);
    await ready.getByRole('checkbox').nth(4).uncheck();
    await expect(page.getByTestId('start-listening')).toHaveText(/開始收聽（已選 4／5）/);
    await expectNoHorizontalOverflow(page);
    await page.getByTestId('start-listening').click();
    await expect(page.getByTestId('count-pill')).toHaveText('01 / 04');
  });

  test('加入一首、全選切換與取消全選', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('seed-input').fill('TEST 第二首');
    await page.getByTestId('add-seed').click();
    await expect(page.getByTestId('seed-list').getByRole('checkbox')).toHaveCount(2);
    await expect(page.getByTestId('generate')).toHaveText(/全選・快速開台/);
    await page.getByTestId('seed-list-all').click();
    await expect(page.getByTestId('generate')).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText('至少勾選');
    await page.getByTestId('seed-list-all').click();
    await expect(page.getByTestId('generate')).toBeEnabled();
  });

  test('引言結束自動接同一首曲目，不會跳進回饋', async ({ page }) => {
    await openApp(page, 'mock');
    await page.getByTestId('generate').click();
    await page.getByTestId('start-listening').click();
    await expect(page.getByTestId('phase-label')).toContainText('播放中', { timeout: 10_000 });
    await expect(page.getByTestId('feedback-card')).toHaveCount(0);
    await expect(page.getByTestId('count-pill')).toHaveText('01 / 05');
  });

  test('回饋時收聽頁保留曲目資訊；迷你播放器是可按的「回收聽」', async ({ page }) => {
    await openApp(page, 'mock');
    await page.getByTestId('generate').click();
    await page.getByTestId('start-listening').click();
    await page.getByTestId('skip-intro').click();
    await expect(page.getByTestId('phase-label')).toContainText('播放中', { timeout: 10_000 });
    await page.getByTestId('next').click();
    await expect(page.getByTestId('feedback-card')).toBeVisible();
    await expect(page.getByTestId('track-title')).toBeVisible();
    await expect(page.getByTestId('feedback-for')).toBeVisible();
    await page.getByTestId('tab-settings').click();
    const toggle = page.getByTestId('mini-toggle');
    await expect(toggle).toHaveAttribute('aria-label', '回收聽');
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(page.getByTestId('feedback-card')).toBeVisible();
  });

  test('引言可展開看完整', async ({ page }) => {
    await openApp(page, 'mock');
    await page.getByTestId('generate').click();
    await page.getByTestId('start-listening').click();
    // MOCK 提示音很短：先暫停介紹（暫停中介紹條仍在），避免和自動進歌賽跑。
    await page.getByTestId('play-toggle').click();
    await expect(page.getByTestId('dj-strip')).toContainText('介紹已暫停');
    const expand = page.getByTestId('dj-expand');
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expand.click();
    await expect(expand).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('dj-strip')).toContainText('聽的時候');
  });
});
