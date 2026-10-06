import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** Fails if the document scrolls horizontally (docs/02: no horizontal scroll from 360px). */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, 'document scrollWidth must fit the viewport').toBeLessThanOrEqual(page.viewportSize()!.width);
}

/** The element must sit fully above the fixed bottom bar (nav + optional mini-player). */
export async function expectNotCoveredByBottomBar(page: Page, testId: string): Promise<void> {
  const target = page.getByTestId(testId);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  const barTop = await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="主要導覽"]');
    const bar = nav?.parentElement;
    return bar ? bar.getBoundingClientRect().top : window.innerHeight;
  });
  expect(box, `${testId} has a box`).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0), `${testId} bottom vs bar top`).toBeLessThanOrEqual(barTop + 0.5);
}

/** Like expectNotCoveredByBottomBar but without scrolling: the control must be on the first screen. */
export async function expectOnFirstScreen(page: Page, testId: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await page.getByTestId(testId).boundingBox();
  const barTop = await page.evaluate(() => {
    const bar = document.querySelector('nav[aria-label="主要導覽"]')?.parentElement;
    return bar ? bar.getBoundingClientRect().top : window.innerHeight;
  });
  expect(box, `${testId} has a box`).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0), `${testId} bottom vs bar top (no scroll)`).toBeLessThanOrEqual(barTop + 0.5);
}

export async function openApp(page: Page, playbackMode?: 'mock'): Promise<void> {
  await page.goto('/?developer=1');
  await expect(page.getByTestId('mode-badge')).toContainText('MOCK');
  if (playbackMode === 'mock') await choosePlaybackMode(page, 'mock');
}

export async function fillSeed(page: Page, text: string): Promise<void> {
  await page.getByTestId('seed-input').fill(text);
}

export async function chooseScenario(page: Page, label: string): Promise<void> {
  await page.getByTestId('tab-settings').click();
  await page.getByRole('group', { name: 'MOCK 開台情境' }).getByRole('button', { name: label }).click();
  await page.getByTestId('tab-home').click();
}

/** BRA-117 起開台預設是「歌曲」種子清單；需要自由文字的流程先切到「從一種感覺」（BRA-170）。 */
export async function chooseFeeling(page: Page): Promise<void> {
  await page.getByRole('radio', { name: '從一種感覺', exact: true }).click();
}

export async function generate(page: Page, text = 'TEST fake seed'): Promise<void> {
  await chooseFeeling(page);
  await fillSeed(page, text);
  await page.getByTestId('generate').click();
  await expect(page.getByTestId('generation-view')).toBeVisible();
}

export async function choosePlaybackMode(page: Page, mode: 'manual' | 'mock'): Promise<void> {
  await page.getByTestId('tab-settings').click();
  await page.getByRole('radio', { name: mode === 'manual' ? 'B · 手動（預設）' : 'MOCK · 合成測試音', exact: true }).check();
  await page.getByTestId('tab-home').click();
}

export async function skipFeedback(page: Page): Promise<void> {
  await page.getByRole('button', { name: '略過回饋', exact: true }).click();
}

/**
 * 透過既有 API 把帳本恢復中性：清掉所有釘選／封鎖、評價全改「還行」（選歌規則不加權）。
 * 其他 spec 共用同一台伺服器與帳本，留下的釘選／封鎖／愛／不對會改變它們的 MOCK 節目順序。
 */
export async function neutralizeLedger(request: APIRequestContext): Promise<void> {
  const session = await request.post('/api/session');
  expect(session.ok()).toBe(true);
  const { csrfToken } = (await session.json()) as { csrfToken: string };
  const headers = { 'X-CSRF-Token': csrfToken };
  const response = await request.get('/api/taste/marks');
  expect(response.ok()).toBe(true);
  const { marks } = (await response.json()) as { marks: { trackKey: string; mark: string | null; rating: string | null }[] };
  for (const mark of marks) {
    const edit = { ...(mark.mark !== null ? { mark: null } : {}), ...(mark.rating !== null && mark.rating !== '還行' ? { rating: '還行' } : {}) };
    if (Object.keys(edit).length === 0) continue;
    expect((await request.post('/api/taste/marks', { headers, data: { target: { trackKey: mark.trackKey }, ...edit } })).ok()).toBe(true);
  }
}
