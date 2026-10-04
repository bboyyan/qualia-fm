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

export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('mode-badge')).toContainText('MOCK');
}

export async function fillSeed(page: Page, text: string): Promise<void> {
  await page.getByTestId('seed-input').fill(text);
}

export async function chooseScenario(page: Page, label: string): Promise<void> {
  await page.getByTestId('tab-settings').click();
  await page.getByRole('group', { name: 'MOCK 開台情境' }).getByRole('button', { name: label }).click();
  await page.getByTestId('tab-home').click();
}

export async function generate(page: Page, text = '深夜，還不想睡；暖一點，別太躁。'): Promise<void> {
  await fillSeed(page, text);
  await page.getByTestId('generate').click();
  await expect(page.getByTestId('generation-view')).toBeVisible();
}
