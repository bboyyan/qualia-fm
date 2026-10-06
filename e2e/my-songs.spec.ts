import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, neutralizeLedger } from './support';

/**
 * BRA-135「我的歌」：預設網址（無 ?developer=1）走真的品味帳本 API（BRA-134）。
 * 帳本資料先用 API 開一輪節目、送聽完回饋寫進去（與使用者聽完回饋同一條路）；畫面上的動作再寫回同一本帳。
 * 每個測試開頭清掉帳本上所有釘選／封鎖，讓三種手機寬度共用同一台伺服器時仍可重現。
 */

const NOISE = /MOCK|TEST|假帳本|路徑 P|經核可模式/i;

interface Seeded {
  readonly titles: readonly string[];
  readonly artist: string;
}

async function csrfOf(request: APIRequestContext): Promise<string> {
  const session = await request.post('/api/session');
  expect(session.ok()).toBe(true);
  return ((await session.json()) as { csrfToken: string }).csrfToken;
}

/** 用 API 開一輪節目，清掉帳本上的標記，再對前四首送聽完回饋（還行／愛＋短評／還行／不對）。 */
async function seedLedger(request: APIRequestContext): Promise<Seeded> {
  const csrf = await csrfOf(request);
  const headers = { 'X-CSRF-Token': csrf };
  const plan = await request.post('/api/plan', {
    headers: { ...headers, 'Idempotency-Key': `plan_${randomUUID().replaceAll('-', '')}` },
    data: { seed: { kind: 'feeling', text: '夜裡慢慢放鬆', artist: null }, requestedCount: 5, dj: { enabled: false, length: 'short' }, tuning: null },
  });
  expect(plan.status()).toBe(202);
  const { jobId } = (await plan.json()) as { jobId: string };
  let showId: string | null = null;
  await expect.poll(async () => {
    const job = (await (await request.get(`/api/jobs/${jobId}`)).json()) as { status: string; showId: string | null };
    showId = job.showId;
    return job.status;
  }, { timeout: 15_000 }).toBe('completed');
  const show = (await (await request.get(`/api/shows/${showId}`)).json()) as { showId: string; segments: { segmentId: string; candidate: { title: string; artist: string } }[] };
  const marks = (await (await request.get('/api/taste/marks')).json()) as { marks: { trackKey: string; mark: string | null }[] };
  for (const mark of marks.marks.filter((item) => item.mark !== null)) {
    expect((await request.post('/api/taste/marks', { headers, data: { target: { trackKey: mark.trackKey }, mark: null } })).ok()).toBe(true);
  }
  const ratings = [['還行', ''], ['愛', '溫暖的空間感'], ['還行', ''], ['不對', '鼓太重']] as const;
  for (const [index, [rating, reason]] of ratings.entries()) {
    const segment = show.segments[index]!;
    const res = await request.post('/api/feedback', { headers, data: { showId: show.showId, segmentId: segment.segmentId, rating, reason, clientRequestId: `e2e${randomUUID().replaceAll('-', '')}` } });
    expect(res.status()).toBe(201);
  }
  return { titles: show.segments.slice(0, 4).map((segment) => segment.candidate.title), artist: show.segments[0]!.candidate.artist };
}

test.afterEach(async ({ page }) => {
  await neutralizeLedger(page.request);
});

const rowOf = (page: Page, title: string) => page.getByTestId('song-row').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

/** 介面本身（去掉帳本裡的曲名／藝人／短評）不得出現模式列、假帳本或測試字樣。 */
async function expectClean(page: Page): Promise<void> {
  const chrome = await page.evaluate(() => {
    const body = document.body.cloneNode(true) as HTMLElement;
    body.querySelectorAll('[data-song-data]').forEach((node) => node.remove());
    return body.textContent ?? '';
  });
  expect(chrome).not.toMatch(NOISE);
  for (const id of ['mode-badge', 'mode-strip', 'device-card', 'device-status', 'redetect']) await expect(page.getByTestId(id)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
}

async function search(page: Page, text: string): Promise<void> {
  await page.getByTestId('songs-search').fill(text);
}

async function toggle(page: Page, title: string, name: '收藏' | '釘選' | '封鎖'): Promise<void> {
  await rowOf(page, title).getByRole('button', { name, exact: true }).click();
}

async function expectToast(page: Page, text: string): Promise<void> {
  await expect(page.getByTestId('toast').first()).toContainText(text);
}

test('BRA-135：預設路徑在「我的歌」完成收藏、釘選（含上限提示）、封鎖、看紀錄與當種子開台', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { titles, artist } = await seedLedger(page.request);
  const [plain, loved, third, disliked] = titles as [string, string, string, string];

  await page.goto('/');
  const nav = page.getByRole('navigation', { name: '主要導覽' });
  await expect(nav.getByRole('button')).toHaveText(['開台', '收聽', '我的', '設定']);
  await page.getByTestId('tab-mine').click();
  await expect(page.getByRole('heading', { level: 1, name: '我的歌' })).toBeVisible();
  await expect(page.getByTestId('pin-status')).toContainText('釘選 0／2');
  await expectClean(page);
  for (const row of await page.getByTestId('song-row').all()) {
    await expect(row.locator('[data-testid="song-artwork"], [data-testid="song-artwork-placeholder"]')).toHaveCount(1);
  }


  // 看最近評價：帳本裡的「愛＋短評」直接出現在列上。
  await search(page, loved);
  await expect(page.getByTestId('song-row')).toHaveCount(1);
  await expect(rowOf(page, loved).getByTestId('song-rating')).toContainText('最近評價：愛・「溫暖的空間感」');

  // 收藏：還行 → 愛；「收藏」濾鏡找得到。
  await search(page, plain);
  await toggle(page, plain, '收藏');
  await expectToast(page, `已收藏〈${plain}〉`);
  await expect(rowOf(page, plain).getByRole('button', { name: '收藏', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('radio', { name: '收藏', exact: true }).click();
  await expect(rowOf(page, plain)).toBeVisible();
  await page.getByRole('radio', { name: '全部', exact: true }).click();

  // 釘選兩首到上限；第三首只提示、不送出。
  await toggle(page, plain, '釘選');
  await expectToast(page, `已釘選〈${plain}〉`);
  await search(page, loved);
  await toggle(page, loved, '釘選');
  await expect(page.getByTestId('pin-status')).toContainText('釘選 2／2・已滿');
  await search(page, third);
  await toggle(page, third, '釘選');
  await expectToast(page, '釘選已滿 2 首（每輪開台都會帶上），先取消一首再釘。');
  await expect(rowOf(page, third).getByRole('button', { name: '釘選', exact: true })).toHaveAttribute('aria-pressed', 'false');

  // 封鎖：只剩「封鎖」鈕，「封鎖」濾鏡列得到。
  await search(page, disliked);
  await toggle(page, disliked, '封鎖');
  await expectToast(page, `已封鎖〈${disliked}〉，不會再排進節目。`);
  await expect(rowOf(page, disliked)).toContainText('已封鎖');
  await expect(rowOf(page, disliked).getByRole('button', { name: '當種子開台' })).toHaveCount(0);
  await search(page, '');
  await page.getByRole('radio', { name: '封鎖', exact: true }).click();
  await expect(page.getByTestId('song-row')).toHaveCount(1);
  await page.getByRole('radio', { name: '全部', exact: true }).click();

  // 重新整理後狀態仍在（寫進真的帳本，不是畫面暫存）。展開帳本紀錄看得到剛剛的動作。
  await page.reload();
  await page.getByTestId('tab-mine').click();
  await expect(page.getByTestId('pin-status')).toContainText('釘選 2／2');
  await search(page, plain);
  const row = rowOf(page, plain);
  await expect(row.getByRole('button', { name: '釘選', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await row.getByRole('button', { name: '曲目資訊與帳本紀錄' }).click();
  const history = row.getByTestId('song-history');
  await expect(history).toContainText('釘選');
  await expect(history).toContainText('改評價：愛');
  await expect(history).toContainText('聽完回饋：還行');
  await expectClean(page);
  if (['mobile-360', 'mobile-390', 'mobile-430'].includes(testInfo.project.name)) {
    await search(page, '');
    await page.getByTestId('songs-search').blur();
    await page.evaluate(() => window.scrollTo(0, 0));
    const path = testInfo.outputPath(`bra135-my-songs-${testInfo.project.name}.png`);
    await page.screenshot({ path });
    expect((await stat(path)).size).toBeLessThan(400 * 1024);
    await search(page, plain);
  }

  // 當種子開台：送出只含這首的歌曲種子，回到開台頁看進度。
  const planBody = page.waitForRequest((request) => request.url().endsWith('/api/plan') && request.method() === 'POST');
  await row.getByRole('button', { name: '當種子開台' }).click();
  expect((await planBody).postDataJSON()).toMatchObject({ seed: { kind: 'song', text: plain, artist } });
  await expect(page.getByTestId('tab-home')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('generation-view')).toBeVisible();
  expect(errors).toEqual([]);
});

test('BRA-135：帳本讀不到時明示錯誤並可重試，不顯示假清單', async ({ page }) => {
  let failing = true;
  await page.route('**/api/taste/marks', async (route) => {
    if (failing && route.request().method() === 'GET') await route.fulfill({ status: 500, json: { error: { code: 'INTERNAL', message: '品味帳本目前無法讀取，請稍後再試。', retryable: true, requestId: 'e2e', retryAfterMs: null } } });
    else await route.continue();
  });
  await page.goto('/');
  await page.getByTestId('tab-mine').click();
  await expect(page.getByTestId('songs-error')).toContainText('暫時讀不到我的歌');
  await expect(page.getByTestId('song-row')).toHaveCount(0);
  await expectClean(page);
  failing = false;
  await page.getByRole('button', { name: '重新讀取' }).click();
  await expect(page.getByTestId('songs-error')).toHaveCount(0);
  await expect(page.getByTestId('pin-status').or(page.getByTestId('songs-empty'))).toBeVisible();
});

test('BRA-135 回歸：釘選歌可取消收藏再收藏，釘選狀態保持', async ({ page }) => {
  const { titles } = await seedLedger(page.request);
  const title = titles[1]!;
  await page.goto('/');
  await page.getByTestId('tab-mine').click();
  await search(page, title);
  await toggle(page, title, '釘選');
  const row = rowOf(page, title);
  await expect(row.getByRole('button', { name: '釘選', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await toggle(page, title, '收藏');
  await expect(row.getByRole('button', { name: '收藏', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(row.getByTestId('song-rating')).toContainText('還行');
  await toggle(page, title, '收藏');
  await expect(row.getByRole('button', { name: '收藏', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(row.getByTestId('song-rating')).toContainText('愛');
  await expect(row.getByRole('button', { name: '釘選', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('BRA-135 回歸：重讀失敗保留舊清單並提示過期，可由 inline recovery 重試', async ({ page }) => {
  const { titles } = await seedLedger(page.request);
  await page.goto('/');
  await page.getByTestId('tab-mine').click();
  await expect(rowOf(page, titles[0]!)).toBeVisible();
  let failing = true;
  await page.route('**/api/taste/marks', async (route) => {
    if (failing && route.request().method() === 'GET') await route.fulfill({ status: 500, json: { error: { code: 'INTERNAL', message: '品味帳本目前無法讀取，請稍後再試。', retryable: true, requestId: 'e2e', retryAfterMs: null } } });
    else await route.continue();
  });
  await page.getByTestId('tab-home').click();
  await page.getByTestId('tab-mine').click();
  const recovery = page.getByTestId('songs-error');
  await expect(recovery).toContainText('上次讀到的清單');
  await expect(recovery).toContainText('可能已過期');
  await expect(rowOf(page, titles[0]!)).toBeVisible();
  await recovery.getByRole('button', { name: '重新讀取' }).click();
  await expect(recovery.getByRole('button', { name: '重新讀取' })).toBeEnabled();
  await expect(recovery).toBeVisible();
  failing = false;
  await recovery.getByRole('button', { name: '重新讀取' }).click();
  await expect(recovery).toHaveCount(0);
  await expect(rowOf(page, titles[0]!)).toBeVisible();
  await expectClean(page);
});

test('BRA-135 回歸：寫入失敗持續顯示錯誤，搜尋後仍可重試原動作', async ({ page }) => {
  const { titles } = await seedLedger(page.request);
  const title = titles[0]!;
  let failing = true;
  const edits: unknown[] = [];
  await page.route('**/api/taste/marks', async (route) => {
    if (route.request().method() === 'POST') {
      edits.push(route.request().postDataJSON());
      if (failing) {
        await route.fulfill({ status: 500, json: { error: { code: 'INTERNAL', message: '品味帳本寫入失敗，請再試一次。', retryable: true, requestId: 'e2e', retryAfterMs: null } } });
        return;
      }
    }
    await route.continue();
  });
  await page.goto('/');
  await page.getByTestId('tab-mine').click();
  await search(page, title);
  await toggle(page, title, '收藏');
  const recovery = page.getByTestId('songs-action-error');
  await expect(recovery).toContainText('品味帳本寫入失敗');
  await expect(recovery).toContainText(title);
  await expect(rowOf(page, title).getByRole('button', { name: '收藏', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 7_000 });
  await search(page, titles[1]!);
  await expect(recovery).toBeVisible();
  await recovery.getByRole('button', { name: '重試收藏', exact: true }).click();
  await expect(recovery.getByRole('button', { name: '重試收藏', exact: true })).toBeEnabled();
  await expect(recovery).toBeVisible();
  failing = false;
  await recovery.getByRole('button', { name: '重試收藏', exact: true }).click();
  await expect(recovery).toHaveCount(0);
  expect(edits).toHaveLength(3);
  expect(edits[1]).toEqual(edits[0]);
  expect(edits[2]).toEqual(edits[0]);
  await search(page, title);
  await expect(rowOf(page, title).getByRole('button', { name: '收藏', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expectClean(page);
});

test('BRA-156：開台同步釘選／收藏、去重與封鎖，取消後重開／重整更新並可勾選開台', async ({ page }, testInfo) => {
  const { titles, artist } = await seedLedger(page.request);
  const [pinned, loved, next, blocked] = titles as [string, string, string, string];
  await page.goto('/');
  await page.getByTestId('tab-mine').click();
  await toggle(page, pinned, '釘選');
  await expect(rowOf(page, pinned).getByRole('button', { name: '釘選', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await toggle(page, blocked, '收藏');
  await expect(rowOf(page, blocked).getByRole('button', { name: '收藏', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await toggle(page, blocked, '封鎖');
  await expect(rowOf(page, blocked)).toContainText('已封鎖');
  await page.getByTestId('tab-home').click();
  const library = page.getByTestId('ledger-seeds');
  await expect(library.locator('summary')).toContainText('我的歌（2）');
  await expect(library).not.toHaveAttribute('open', '');
  await expect(page.getByTestId('generate')).toHaveText('全選・快速開台');
  await page.screenshot({ path: testInfo.outputPath('bra156-home-collapsed.png') });
  await library.locator('summary').click();
  const list = page.getByTestId('ledger-seed-list');
  const check = (title: string) => list.getByRole('checkbox', { name: new RegExp(title) });
  await expect(check(pinned)).not.toBeChecked();
  await expect(check(loved)).not.toBeChecked();
  await expect(page.getByTestId('generate')).toHaveText('快速開台（已選 1／3）');
  await page.getByTestId('ledger-seed-list-all').click();
  await expect(check(pinned)).toBeChecked();
  await expect(check(loved)).toBeChecked();
  await expect(page.getByTestId('generate')).toHaveText('全選・快速開台');
  await page.getByTestId('ledger-seed-list-all').click();
  await expect(page.getByTestId('generate')).toHaveText('快速開台（已選 1／3）');
  await library.locator('summary').click();
  await expect(page.getByTestId('generate')).toHaveText('全選・快速開台');
  await library.locator('summary').click();
  await expect(page.getByRole('checkbox', { name: new RegExp(blocked) })).toHaveCount(0);
  await expect(list.getByRole('button', { name: /從清單移除/ })).toHaveCount(0);
  await check(loved).check();
  await check(loved).uncheck();
  // 手動重新輸入封鎖同曲也不加入，保留輸入與解除封鎖提示。
  await page.getByTestId('seed-input').fill(blocked);
  await page.getByLabel('藝人（選填）').fill(artist);
  await page.getByTestId('add-seed').click();
  await expect(page.getByTestId('seed-input')).toHaveValue(blocked);
  await expect(page.getByRole('alert')).toContainText('已封鎖');
  await expect(page.getByRole('checkbox', { name: new RegExp(blocked) })).toHaveCount(0);
  // 同曲手動加入只勾選既有列，不能重複列出。
  await page.getByTestId('seed-input').fill(loved);
  await page.getByLabel('藝人（選填）').fill(artist);
  await page.getByTestId('add-seed').click();
  await expect(page.getByRole('checkbox', { name: new RegExp(loved) })).toHaveCount(1);
  await expect(check(loved)).toBeChecked();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('bra156-home-expanded.png') });
  // 本輪取消勾選不改帳本，重開仍不自動勾回。
  await check(loved).uncheck();
  await page.getByTestId('tab-mine').click();
  await expect(rowOf(page, loved).getByRole('button', { name: '收藏', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await toggle(page, pinned, '釘選');
  await expect(rowOf(page, pinned).getByRole('button', { name: '釘選', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('tab-home').click();
  await library.locator('summary').click();
  await expect(check(pinned)).toHaveCount(0);
  await expect(check(loved)).not.toBeChecked();
  await page.getByTestId('tab-mine').click();
  await toggle(page, loved, '收藏');
  await expect(rowOf(page, loved).getByRole('button', { name: '收藏', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(library).toHaveCount(0);
  // 重整後新增釘選，重開開台頁可選擇並送出該首。
  await page.getByTestId('tab-mine').click();
  await toggle(page, next, '釘選');
  await expect(rowOf(page, next).getByRole('button', { name: '釘選', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // 預設路徑不呈現 MOCK 節目；只有最後的 Ready 驗證使用既有 developer 預覽。
  await page.goto('/?developer=1');
  await library.locator('summary').click();
  await page.getByTestId('seed-list').getByRole('checkbox').uncheck();
  await check(next).check();
  const request = page.waitForRequest((req) => req.url().endsWith('/api/plan') && req.method() === 'POST');
  await page.getByTestId('generate').click();
  expect((await request).postDataJSON()).toMatchObject({ seed: { kind: 'song', text: next, artist } });
  await expect(page.getByTestId('ready-view')).toBeVisible();
});

test('BRA-173：封面成功／失敗與透明官方標誌；展開可讀全文', async ({ page }) => {
  const { titles } = await seedLedger(page.request);
  const title = titles[0]!;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#294F42"/></svg>';
  // 此情境只模擬展示 API，伺服器未啟用 Spotify，CSP 仍拒絕 i.scdn.co。
  // 圖片 fixture 用同源路由，驗證載入／onError，不繞過或放寬正式 CSP。
  const artworkRequests = new Set<string>();
  await page.route('**/test-artwork/bra173-*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    artworkRequests.add(path);
    if (path.endsWith('bad')) return route.abort();
    await route.fulfill({ contentType: 'image/svg+xml', body: svg });
  });
  await page.route('**/api/spotify/song-display', async (route) => {
    const { trackKeys } = route.request().postDataJSON() as { trackKeys: string[] };
    await route.fulfill({ json: { items: trackKeys.map((trackKey) => ({ trackKey, status: 'available', metadata: {
      canonicalTitle: trackKey.includes(title.toLowerCase()) ? title : '很長的曲名'.repeat(20),
      canonicalArtists: ['很長的歌手'.repeat(20)], canonicalAlbum: '專輯全文',
      artworkUrl: `/test-artwork/bra173-${trackKey.includes(title.toLowerCase()) ? 'good' : 'bad'}`,
      externalUrl: 'https://open.spotify.com/track/test',
    } })) } });
  });
  await page.goto('/');
  await page.getByTestId('tab-mine').click();
  await search(page, title);
  const row = page.getByTestId('song-row');
  await expect(row.getByTestId('song-artwork')).toBeVisible();
  await expect.poll(() => row.getByTestId('song-artwork').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(64);
  expect(artworkRequests.has('/test-artwork/bra173-good')).toBe(true);
  await row.getByRole('button', { name: '釘選', exact: true }).click();
  const logo = row.getByTestId('spotify-logo');
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((img) => getComputedStyle(img.parentElement!).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  for (const button of await row.getByRole('group').getByRole('button').all()) {
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  await search(page, titles[1]!);
  await expect(row.getByTestId('spotify-logo')).toBeVisible();
  await expect(row.getByTestId('song-artwork-placeholder')).toBeVisible();
  await expect(row.getByTestId('song-artwork')).toHaveCount(0);
  expect(artworkRequests.has('/test-artwork/bra173-bad')).toBe(true);
  await row.getByRole('button', { name: '曲目資訊與帳本紀錄' }).click();
  await expect(row.getByText('專輯：專輯全文')).toBeVisible();
  await expect(row.getByRole('link', { name: '在 Spotify 開啟' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
