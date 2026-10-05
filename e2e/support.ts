import { expect, type Page } from '@playwright/test';

/** Fails if the document scrolls horizontally (docs/02: no horizontal scroll from 360px). */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
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

/** BRA-117 起開台預設是「歌曲」種子清單；需要自由文字的流程先切到「感覺」。 */
export async function chooseFeeling(page: Page): Promise<void> {
  await page.getByRole('radio', { name: '感覺', exact: true }).click();
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
