import { expect, test } from '@playwright/test';
import { chooseScenario, expectNoHorizontalOverflow, fillSeed, generate, openApp } from './support';

test.describe('T03 開台與生成', () => {
  test('happy path: real phases, then ready with 5 tracks and no autoplay (AC10)', async ({ page }) => {
    await openApp(page);
    await generate(page);
    await expect(page.getByRole('list', { name: /生成階段/ })).toBeVisible();
    await expect(page.getByTestId('ready-view')).toBeVisible();
    await expect(page.getByTestId('ready-count')).toContainText('已準備 5 首');
    await expect(page.getByText('尚未開始播放')).toBeVisible();
    await expect(page.getByTestId('start-listening')).toHaveText(/開始收聽/);
    await expect(page.getByText('感覺鉤子')).toBeVisible();
    await expect(page.getByText('尚無資料，不做推測')).toBeVisible();
    const playing = await page.evaluate(() => [...document.querySelectorAll('audio')].some((a) => !a.paused));
    expect(playing).toBe(false);
    await expectNoHorizontalOverflow(page);
  });

  test('cancel returns to the composer with the input kept, and a late result never appears (AC04)', async ({ page }) => {
    await openApp(page);
    await generate(page, '取消後保留這段字');
    await page.getByTestId('cancel-generation').click();
    await expect(page.getByTestId('seed-input')).toHaveValue('取消後保留這段字');
    await page.waitForTimeout(2_500);
    await expect(page.getByTestId('ready-view')).toHaveCount(0);
  });

  test('partial: 3 playable tracks are reported honestly with a re-pick option (AC07)', async ({ page }) => {
    await openApp(page);
    await chooseScenario(page, '部分：3 首');
    await generate(page);
    await expect(page.getByTestId('partial-notice')).toContainText('已確認 3 首');
    await expect(page.getByTestId('ready-count')).toContainText('已準備 3 首');
    await expect(page.getByRole('button', { name: '重新選歌' })).toBeVisible();
  });

  test('zero: keeps the analysis, lists unconfirmed candidates, offers 修改感覺 and no player (AC07)', async ({ page }) => {
    await openApp(page);
    await chooseScenario(page, '0 首可播');
    await generate(page);
    await expect(page.getByTestId('zero-notice')).toContainText('尚無可播曲目');
    await expect(page.getByTestId('zero-notice')).toContainText('待確認');
    await expect(page.getByTestId('start-listening')).toHaveCount(0);
    await page.getByRole('button', { name: '修改感覺' }).click();
    await expect(page.getByTestId('seed-input')).toHaveValue('深夜，還不想睡；暖一點，別太躁。');
  });

  test('error: shows reason and retry inline, input preserved (AC06)', async ({ page }) => {
    await openApp(page);
    await chooseScenario(page, '編排失敗');
    await generate(page);
    await expect(page.getByTestId('generation-error')).toContainText('這次編排沒有成功');
    await expect(page.getByRole('button', { name: '再試一次' })).toBeVisible();
    await page.getByRole('button', { name: '修改感覺' }).click();
    await expect(page.getByTestId('seed-input')).toHaveValue('深夜，還不想睡；暖一點，別太躁。');
  });

  test('song mode sends title and artist through the same pipeline (AC03)', async ({ page }) => {
    await openApp(page);
    await page.getByRole('radio', { name: '歌曲' }).click();
    await fillSeed(page, '某首歌');
    await page.getByLabel('藝人（選填）').fill('某位藝人');
    await page.getByTestId('generate').click();
    await expect(page.getByTestId('ready-view')).toContainText('MOCK 不認識任何歌曲');
  });

  test('slow: long-wait hint appears after 20 seconds and cancel still works', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'slow scenario runs once, at 390px');
    test.setTimeout(60_000);
    await openApp(page);
    await chooseScenario(page, '慢速（>20 秒）');
    await generate(page);
    const stages = page.getByRole('list', { name: /生成階段/ }).getByRole('listitem');
    await expect(stages.nth(1)).toHaveAttribute('data-state', 'running', { timeout: 5_000 });
    await expect(stages.nth(0)).toHaveAttribute('data-state', 'done');
    await expect(stages.nth(2)).toHaveAttribute('data-state', 'pending');
    await expect(page.getByTestId('long-wait')).toBeVisible({ timeout: 25_000 });
    await page.getByTestId('cancel-generation').click();
    await expect(page.getByTestId('seed-input')).toBeVisible();
  });
});
