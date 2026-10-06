import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow } from './support';

test('BRA-148：首屏保持開台，兩輪履歷重載後可展開、進我的歌與原種子重開', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: '主要導覽' }).getByRole('button')).toHaveText(['開台', '收聽', '我的', '設定']);
  await expect(page.getByRole('button', { name: '開台歷史', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('seed-input')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('bra148-home-mobile-390.png') });
  const session = await (await page.request.post('/api/session')).json() as { csrfToken: string };
  const marker = `BRA148-${testInfo.project.name}-${randomUUID().slice(0, 8)}`;
  const seeds = [`${marker} 雨天散步`, `${marker} 夜裡的聲音`];
  for (const text of seeds) {
    const res = await page.request.post('/api/plan', {
      headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': randomUUID() },
      data: { seed: { kind: 'feeling', text, artist: null }, requestedCount: 5, dj: { enabled: true, length: 'short' }, tuning: null },
    });
    expect(res.status()).toBe(202);
    const { jobId } = await res.json() as { jobId: string };
    await expect.poll(async () => (await (await page.request.get(`/api/jobs/${jobId}`)).json() as { status: string }).status).toBe('completed');
  }
  await page.getByTestId('tab-mine').click();
  await page.getByRole('button', { name: '開台歷史', exact: true }).click();
  const rows = page.getByTestId('show-history-row').filter({ hasText: marker });
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText(seeds[1]!);
  await page.reload();
  await page.getByTestId('tab-mine').click();
  await page.getByRole('button', { name: '開台歷史', exact: true }).click();
  await expect(rows).toHaveCount(2);
  const row = rows.first();
  await row.getByText(seeds[1]!, { exact: false }).first().click();
  await expect(row).toContainText('5 首');
  await expect(row).toContainText('語音未降級');
  await expect(row).toContainText('提示音');
  await expect(row.getByTestId('history-tracks').locator('li')).toHaveCount(5);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('bra148-history-mobile-390.png') });
  await row.getByRole('button', { name: '去我的歌' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '我的歌' })).toBeVisible();
  await page.getByRole('button', { name: '開台歷史', exact: true }).click();
  await rows.first().locator('summary').click();
  const request = page.waitForRequest((req) => req.url().endsWith('/api/plan') && req.method() === 'POST');
  await rows.first().getByRole('button', { name: '用這個種子重開' }).click();
  expect((await request).postDataJSON()).toMatchObject({ seed: { kind: 'feeling', text: seeds[1], artist: null } });
  await expect(page.getByTestId('tab-home')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('generation-view')).toBeVisible();
  expect(errors).toEqual([]);
});

test('BRA-148：歷史讀取失敗可重試，不顯示假清單', async ({ page }) => {
  let failing = true;
  await page.route('**/api/show-history', async (route) => {
    if (failing) await route.fulfill({ status: 500, json: { error: { code: 'INTERNAL', message: '開台歷史目前無法讀取，請稍後再試。', retryable: true, requestId: 'history-test', retryAfterMs: null } } });
    else await route.continue();
  });
  await page.goto('/');
  await page.getByTestId('tab-mine').click();
  await page.getByRole('button', { name: '開台歷史', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('暫時讀不到開台歷史');
  await expect(page.getByTestId('show-history-row')).toHaveCount(0);
  failing = false;
  await page.getByRole('button', { name: '重新讀取', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('list', { name: '開台歷史清單' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
