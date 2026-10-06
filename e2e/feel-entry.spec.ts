/**
 * BRA-170：開台入口「從一首歌／從一種感覺」。新主標、情境標籤單選、完整組句預覽、範例 chip、
 * 1／1 文案（順便修 A）、歌名欄框線（順便修 B）、兩種模式都沒有橫向捲動。全部是 MOCK。
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { chooseFeeling, expectNoHorizontalOverflow, neutralizeLedger, openApp } from './support';

const HEARTBREAK = '失戀後的心情：有點空、溫柔，慢慢走出來';
const mood = (page: Page, label: string) => page.getByTestId('mood-presets').getByRole('button', { name: label, exact: true });

test.describe('BRA-170 開台入口', () => {
  test.beforeEach(async ({ request }) => {
    await neutralizeLedger(request);
  });

  test('預設從一首歌：新主標、兩格入口、沒有舊標題與徽章，1／1 寫「快速開台」，無橫向捲動', async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole('heading', { level: 1, name: /開始探索你的人生終極曲目/ })).toBeVisible();
    await expect(page.getByText('不是同類型')).toHaveCount(0);
    await expect(page.getByText('YOUR FEELING, ON AIR.')).toHaveCount(0);
    const modes = page.getByRole('radiogroup', { name: '輸入方式' }).getByRole('radio');
    await expect(modes).toHaveText(['從一首歌', '從一種感覺']);
    await expect(page.getByRole('radio', { name: '從一首歌', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('generate')).toHaveText('快速開台');
    await expect(page.getByText('常用的一句感受')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('順便修 B：歌名欄和藝人欄一樣有框線', async ({ page }) => {
    await openApp(page);
    const border = (locator: Locator) => locator.evaluate((el) => {
      const style = getComputedStyle(el);
      return `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor} ${style.borderRadius}`;
    });
    const song = await border(page.getByTestId('seed-input'));
    expect(song).toMatch(/^1px solid/);
    expect(song).toBe(await border(page.getByLabel('藝人（選填）')));
  });

  test('點標籤 →「從「失戀」開台」＋預覽全文 → 開台引用同一段全文；再點取消', async ({ page }) => {
    await openApp(page, 'mock');
    await chooseFeeling(page);
    await expect(page.getByTestId('mood-presets').getByRole('button')).toHaveText(['平靜', '振奮', '健身', '失戀', '深夜', '通勤', '專注', '雨天']);
    await mood(page, '失戀').click();
    await expect(mood(page, '失戀')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('generate')).toHaveText('從「失戀」開台');
    await expect(page.getByTestId('seed-preview')).toContainText(HEARTBREAK);
    await mood(page, '深夜').click();
    await expect(mood(page, '失戀')).toHaveAttribute('aria-pressed', 'false');
    await mood(page, '深夜').click();
    await expect(page.getByTestId('mood-presets').locator('[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.getByTestId('generate')).toHaveText('為我開台');
    await mood(page, '失戀').click();
    await page.getByTestId('seed-input').fill('下班一個人走回家');
    const full = `${HEARTBREAK}。下班一個人走回家`;
    await expect(page.getByTestId('seed-preview')).toContainText(full);
    await expect(page.getByTestId('seed-count')).toHaveText(`${[...full].length} / 500`);
    await expectNoHorizontalOverflow(page);
    await page.getByTestId('generate').click();
    await expect(page.getByTestId('ready-view')).toContainText(full);
  });

  test('從一首歌點範例 chip：切到從一種感覺並填入，不選標籤、不開始，歌曲勾選保留', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: '陪我安靜走一段', exact: true }).click();
    await expect(page.getByRole('radio', { name: '從一種感覺', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('seed-input')).toHaveValue('陪我安靜走一段');
    await expect(page.getByTestId('mood-presets').locator('[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.getByTestId('generation-view')).toHaveCount(0);
    await expect(page.getByTestId('generate')).toHaveText('為我開台');
    await page.getByRole('button', { name: '夜裡慢慢放鬆', exact: true }).click();
    await expect(page.getByTestId('seed-input')).toHaveValue('夜裡慢慢放鬆');
    await page.getByRole('radio', { name: '從一首歌', exact: true }).click();
    await expect(page.getByTestId('seed-list').getByRole('checkbox')).toBeChecked();
    await expect(page.getByTestId('seed-input')).toHaveValue('');
  });

  test('從一種感覺全空：按鈕停用，預覽說明原因', async ({ page }) => {
    await openApp(page);
    await chooseFeeling(page);
    await expect(page.getByTestId('generate')).toBeDisabled();
    await expect(page.getByTestId('generate')).toHaveText('為我開台');
    await expect(page.getByTestId('seed-preview')).toContainText('先選一個感覺，或寫一句。');
    await expectNoHorizontalOverflow(page);
  });
});
