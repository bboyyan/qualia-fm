import { ERROR_MESSAGES, type JobInfo } from '../packages/contracts/src/index';
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
    await expect(page.getByText('尚無資料，不做推測').first()).toBeVisible();
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
    await expect(page.getByTestId('partial-notice')).toContainText('先聽這 3 首');
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
    await expect(page.getByTestId('seed-input')).toHaveValue('TEST fake seed');
  });

  test('error: shows reason and retry inline, input preserved (AC06)', async ({ page }) => {
    await openApp(page);
    await chooseScenario(page, '編排失敗');
    await generate(page);
    await expect(page.getByTestId('generation-error')).toContainText('這次編排沒有成功');
    await expect(page.getByRole('button', { name: '再試一次' })).toBeVisible();
    await page.getByRole('button', { name: '修改感覺' }).click();
    await expect(page.getByTestId('seed-input')).toHaveValue('TEST fake seed');
  });

  test('quota failed job shows the usage limit without INTERNAL, SIGNAL LOST or a MOCK show', async ({ page }) => {
    let showRequests = 0;
    const failed: JobInfo = {
      jobId: 'job-quota', generationId: 'generation-quota', status: 'failed', phase: 'understanding', showId: null,
      error: { code: 'QUOTA_EXCEEDED', message: ERROR_MESSAGES.QUOTA_EXCEEDED, retryable: false, retryAfterMs: null, requestId: 'req-quota' },
    };
    await page.route('**/api/plan', (route) => route.fulfill({ status: 202, json: { ...failed, status: 'queued', phase: 'queued', error: null } }));
    await page.route('**/api/jobs/job-quota', (route) => route.fulfill({ json: failed }));
    await page.route('**/api/shows/*', (route) => { showRequests += 1; return route.abort(); });
    // 一般使用者模式，經過正式 generation controller 與 show guard。
    await page.goto('/');
    await generate(page, '上限後保留這段感覺');
    await expect(page.getByTestId('generation-error')).toContainText('已達這段時間的使用上限，可以先聽既有節目。');
    await expect(page.getByRole('heading', { name: '已達使用上限。', exact: true })).toBeVisible();
    await expect(page.getByText('SIGNAL LOST', { exact: true })).toHaveCount(0);
    await expect(page.getByText('服務暫時出了點問題', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '再試一次', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('ready-view')).toHaveCount(0);
    expect(showRequests).toBe(0);
    await expectNoHorizontalOverflow(page);
    await page.getByRole('button', { name: '修改感覺', exact: true }).click();
    await expect(page.getByTestId('seed-input')).toHaveValue('上限後保留這段感覺');
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
