import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, expectNotCoveredByBottomBar, fillSeed, openApp } from './support';

test.describe('T02 shell and design foundation', () => {
  test('opens in mock mode with three labelled tabs and no horizontal overflow', async ({ page }) => {
    await openApp(page);
    const nav = page.getByRole('navigation', { name: '主要導覽' });
    await expect(nav.getByRole('button')).toHaveText(['開台', '收聽', '設定']);
    await expect(page.getByTestId('tab-home')).toHaveAttribute('aria-current', 'page');
    for (const tab of ['listen', 'settings', 'home'] as const) {
      await page.getByTestId(`tab-${tab}`).click();
      await expectNoHorizontalOverflow(page);
    }
  });

  test('listen tab shows an actionable empty state, not a dead end', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('tab-listen').click();
    await expect(page.getByRole('heading', { name: /從一個感覺開始/ })).toBeVisible();
    await page.getByRole('button', { name: '去開台' }).click();
    await expect(page.getByTestId('tab-home')).toHaveAttribute('aria-current', 'page');
  });

  test('browser Back returns to the previous tab', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('tab-settings').click();
    await page.goBack();
    await expect(page.getByTestId('tab-home')).toHaveAttribute('aria-current', 'page');
  });

  test('environment sheet: focus moves in, Escape closes, focus returns to the badge', async ({ page }) => {
    await openApp(page);
    const badge = page.getByTestId('mode-badge');
    await badge.click();
    const sheet = page.getByRole('dialog', { name: '播放環境' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: '關閉面板' })).toBeFocused();
    await expect(sheet).toContainText('只播放程式合成的測試音');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(badge).toBeFocused();
  });

  test('browser Back closes the open sheet before leaving the tab', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('tab-settings').click();
    await page.getByRole('button', { name: '查看完整限制' }).click();
    await expect(page.getByRole('dialog', { name: '播放環境' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('dialog', { name: '播放環境' })).toBeHidden();
    await expect(page.getByTestId('tab-settings')).toHaveAttribute('aria-current', 'page');
  });

  test('example chip only fills the composer and never starts generation', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'TEST 假起點一' }).click();
    await expect(page.getByTestId('seed-input')).toHaveValue('TEST 假起點一');
    await expect(page.getByRole('heading', { name: /不是同類型/ })).toBeVisible();
  });

  test('CTA is disabled when empty; >500 graphemes shows an error and keeps the text (AC02)', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('generate')).toBeDisabled();
    const long = '夜'.repeat(501);
    await fillSeed(page, long);
    await page.getByTestId('seed-input').blur();
    await expect(page.getByRole('alert')).toContainText('500 字以內');
    await expect(page.getByTestId('seed-input')).toHaveValue(long);
    await expect(page.getByTestId('generate')).toBeDisabled();
  });

  test('Enter inserts a newline instead of submitting', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('seed-input').click();
    await page.keyboard.type('第一行');
    await page.keyboard.press('Enter');
    await page.keyboard.type('第二行');
    await expect(page.getByTestId('seed-input')).toHaveValue('第一行\n第二行');
  });

  test('primary CTA is never covered by the bottom navigation', async ({ page }) => {
    await openApp(page);
    await fillSeed(page, 'TEST fake seed');
    await expectNotCoveredByBottomBar(page, 'generate');
  });

  test('segmented control is keyboard operable with arrow keys', async ({ page }) => {
    await openApp(page);
    await page.getByRole('radio', { name: '感覺' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: '歌曲' })).toBeFocused();
    await expect(page.getByRole('radio', { name: '歌曲' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByLabel('藝人（選填）')).toBeVisible();
  });

  test('settings DJ switch exposes checked state and persists across reload', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('tab-settings').click();
    const dj = page.getByRole('switch', { name: 'DJ 介紹' });
    await expect(dj).toHaveAttribute('aria-checked', 'true');
    await dj.click();
    await expect(dj).toHaveAttribute('aria-checked', 'false');
    await page.reload();
    await page.getByTestId('tab-settings').click();
    await expect(page.getByRole('switch', { name: 'DJ 介紹' })).toHaveAttribute('aria-checked', 'false');
  });
});
