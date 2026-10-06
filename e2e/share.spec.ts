import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow } from './support';

/**
 * BRA-129 旅程精選集分享＋繼續旅程。寶石牆入口（BRA-169）尚未合併，這裡用 API 種一本精選集（五首），
 * 再用內部連結 /?share=<短碼> 進入分享頁。連結只在同一個瀏覽器 session 內有效；公開路由預設 404。
 */

interface Seeded {
  readonly code: string;
  readonly titles: readonly string[];
}

/** 在頁面的瀏覽器 context 內（同一個 session cookie）建立一本分享。 */
async function seedShare(page: Page): Promise<Seeded> {
  const request = page.context().request;
  const session = await request.post('/api/session');
  expect(session.ok()).toBe(true);
  const csrf = ((await session.json()) as { csrfToken: string }).csrfToken;
  const run = randomUUID().slice(0, 8);
  const titles = [1, 2, 3, 4, 5].map((n) => `E2E 曲 ${n}-${run}`);
  const tracks = titles.map((title, index) => ({ trackKey: `e2e artist — ${title.toLowerCase()}`, title, artist: index < 3 ? 'E2E Artist' : 'E2E 夜行者', palette: index }));
  const res = await request.post('/api/share', { headers: { 'X-CSRF-Token': csrf }, data: { selectionNo: 2, tracks } });
  expect(res.status()).toBe(201);
  return { code: ((await res.json()) as { code: string }).code, titles };
}

async function countsOf(request: APIRequestContext, code: string): Promise<{ shared: number; opened: number; continued: number }> {
  const res = await request.get(`/api/share/${code}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { counts: { shared: number; opened: number; continued: number } }).counts;
}

async function openShare(page: Page, code: string): Promise<void> {
  await page.goto(`/?share=${code}`);
  await expect(page.getByTestId('share-content')).toBeVisible();
}

test('V2 分享連結解析：唯讀五首與 Spotify 單曲連結、公開連結停用、網址拿掉短碼、記一次開啟', async ({ page }) => {
  const { code, titles } = await seedShare(page);
  await openShare(page, code);
  const sheet = page.getByTestId('share-sheet');
  await expect(sheet.getByRole('heading', { name: '分享旅程精選集' })).toBeVisible();
  const rows = page.getByTestId('share-tracks').getByRole('listitem');
  await expect(rows).toHaveCount(5);
  for (const [index, title] of titles.entries()) {
    await expect(rows.nth(index)).toContainText(title);
    const link = rows.nth(index).getByRole('link', { name: `在 Spotify 找〈${title}〉` });
    await expect(link).toHaveAttribute('href', /^https:\/\/open\.spotify\.com\/search\//);
    await expect(link).toHaveAttribute('target', '_blank');
  }
  const publicLink = page.getByTestId('share-public-link');
  await expect(publicLink).toBeDisabled();
  await expect(publicLink).toContainText('公開分享尚未開放');
  await expect(page).toHaveURL((url) => !url.search.includes('share='));
  await expect(sheet.getByRole('textbox')).toHaveCount(0);
  await expect.poll(async () => (await countsOf(page.context().request, code)).opened).toBe(1);
  await expectNoHorizontalOverflow(page);
});

test('V2 公開路由預設關閉：未登入回 404；未知短碼在 app 內顯示找不到', async ({ page, playwright, baseURL }) => {
  const { code } = await seedShare(page);
  const anonymous = await playwright.request.newContext({ baseURL });
  expect((await anonymous.get(`/api/public/share/${code}`)).status()).toBe(404);
  expect((await anonymous.get(`/api/share/${code}`)).status()).toBe(401);
  await anonymous.dispose();
  await page.goto('/?share=AAAAAAAAAAAA');
  await expect(page.getByTestId('share-missing')).toBeVisible();
});

test('存成圖片：在本機畫出分享卡並下載 PNG', async ({ page }) => {
  const { code } = await seedShare(page);
  await openShare(page, code);
  const download = page.waitForEvent('download');
  await page.getByTestId('share-save-image').click();
  expect((await download).suggestedFilename()).toBe('qualia-journey-selection-02.png');
  await expect(page.getByText('已存成圖片。')).toBeVisible();
});

test('複製連結得到同一個 app 的內部連結，用它再打開仍是同一本', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'clipboard 讀取權限只在 Chromium 可授權');
  const { code, titles } = await seedShare(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await openShare(page, code);
  await page.getByTestId('share-copy-link').click();
  await expect(page.getByText('已複製連結（只在這個 app 內、已登入時打得開）。')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(`${new URL(page.url()).origin}/?share=${code}`);
  const second = await page.context().newPage();
  await second.goto(copied);
  await expect(second.getByTestId('share-tracks').getByRole('listitem').first()).toContainText(titles[0]!);
  await expect.poll(async () => (await countsOf(page.context().request, code)).opened).toBe(2);
});

test('V5＋V3 繼續旅程：用這五首當種子開台，回開台頁看進度，記一次繼續', async ({ page }) => {
  const { code, titles } = await seedShare(page);
  await openShare(page, code);
  const plan = page.waitForRequest((req) => req.url().endsWith('/api/plan') && req.method() === 'POST');
  await page.getByTestId('share-continue').click();
  const body = (await plan).postDataJSON() as { seed: { kind: string; text: string; artist: string | null } };
  expect(body.seed).toEqual({ kind: 'song', text: titles.join('／'), artist: 'E2E Artist／E2E 夜行者' });
  await expect(page.getByTestId('share-sheet')).not.toBeVisible();
  await expect(page.getByTestId('generation-view')).toBeVisible();
  await expect.poll(async () => countsOf(page.context().request, code)).toEqual({ shared: 1, opened: 1, continued: 1 });
});

test('V5 先改一句：預填五首串成的種子，空白不送出，改完可送出', async ({ page }) => {
  const { code, titles } = await seedShare(page);
  await openShare(page, code);
  await page.getByTestId('share-edit').click();
  const input = page.getByTestId('share-edit-input');
  await expect(input).toHaveValue(titles.join('／'));
  await input.fill('   ');
  await page.getByTestId('share-edit-submit').click();
  await expect(page.getByRole('alert')).toContainText('先寫下一點想去的方向');
  await expect(page.getByTestId('share-sheet')).toBeVisible();
  const edited = `${titles[0]}，但更安靜一點`;
  await input.fill(edited);
  const plan = page.waitForRequest((req) => req.url().endsWith('/api/plan') && req.method() === 'POST');
  await page.getByTestId('share-edit-submit').click();
  expect(((await plan).postDataJSON() as { seed: { text: string } }).seed.text).toBe(edited);
  await expect(page.getByTestId('generation-view')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
