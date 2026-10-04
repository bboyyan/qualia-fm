/**
 * Captures review screenshots at the required sizes into docs/implementation/screenshots/.
 * Browser-rendered evidence only — not real-device evidence.
 */
import { test, type Page } from '@playwright/test';
import { chooseScenario, fillSeed, generate, openApp } from './support';

const SIZES = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 1440, height: 900 },
] as const;

const OUT = 'docs/implementation/screenshots';

interface Screen {
  name: string;
  prepare: (page: Page) => Promise<void>;
}

const SCREENS: readonly Screen[] = [
  { name: '01-home', prepare: async () => {} },
  {
    name: '01b-home-filled',
    prepare: async (page) => {
      await fillSeed(page, '深夜，還不想睡；暖一點，別太躁。');
    },
  },
  {
    name: '05-generating',
    prepare: async (page) => {
      await chooseScenario(page, '慢速（>20 秒）');
      await generate(page);
      await page.locator('[data-state="running"]').first().waitFor();
    },
  },
  {
    name: '06-ready',
    prepare: async (page) => {
      await generate(page);
      await page.getByTestId('ready-view').waitFor();
    },
  },
  {
    name: '07-ready-partial-3',
    prepare: async (page) => {
      await chooseScenario(page, '部分：3 首');
      await generate(page);
      await page.getByTestId('partial-notice').scrollIntoViewIfNeeded();
    },
  },
  {
    name: '08-ready-zero',
    prepare: async (page) => {
      await chooseScenario(page, '0 首可播');
      await generate(page);
      await page.getByTestId('zero-notice').scrollIntoViewIfNeeded();
    },
  },
  {
    name: '09-generation-error',
    prepare: async (page) => {
      await chooseScenario(page, '編排失敗');
      await generate(page);
      await page.getByTestId('generation-error').waitFor();
    },
  },
  {
    name: '02-settings',
    prepare: async (page) => {
      await page.getByTestId('tab-settings').click();
    },
  },
  {
    name: '03-environment-sheet',
    prepare: async (page) => {
      await page.getByTestId('mode-badge').click();
      await page.getByRole('dialog', { name: '播放環境' }).waitFor();
    },
  },
  {
    name: '04-listen-empty',
    prepare: async (page) => {
      await page.getByTestId('tab-listen').click();
    },
  },
];

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height}`, () => {
    test.use({ viewport: size, isMobile: size.width < 700, hasTouch: size.width < 700, deviceScaleFactor: 2 });
    for (const screen of SCREENS) {
      test(screen.name, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openApp(page);
        await screen.prepare(page);
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/${screen.name}-${size.width}x${size.height}.png` });
      });
    }
  });
}
