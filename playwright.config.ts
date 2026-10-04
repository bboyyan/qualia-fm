/**
 * Browser-emulated E2E at phone viewports. Chromium mobile emulation is NOT iPhone Safari or a
 * real device; real-device evidence is tracked separately (always NOT TESTED in this build).
 * Uses the already-cached Playwright browsers (no download).
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

const phone = (width: number, height: number) => ({
  ...devices['Desktop Chrome'],
  viewport: { width, height },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'zh-TW',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node apps/server/dist/index.js',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NODE_ENV: 'development',
      PORT: String(PORT),
      APP_ORIGIN: `http://127.0.0.1:${PORT}`,
      MOCK_PHASE_MS: '250',
      MOCK_SLOW_PHASE_MS: '23000',
      MOCK_TRACK_MS: '6000',
      MOCK_SPEECH_MS: '1500',
      SESSION_RATE_LIMIT_PER_MIN: '2000',
      PLAN_RATE_LIMIT_PER_HOUR: '500',
    },
  },
  projects: [
    { name: 'mobile-360', use: phone(360, 800), testIgnore: /screenshots\.spec\.ts/ },
    { name: 'mobile-390', use: phone(390, 844), testIgnore: /screenshots\.spec\.ts/ },
    { name: 'mobile-430', use: phone(430, 932), testIgnore: /screenshots\.spec\.ts/ },
    { name: 'webkit-390', use: { ...devices['Desktop Safari'], viewport: { width: 390, height: 844 } }, testIgnore: /screenshots\.spec\.ts/ },
    { name: 'screenshots', use: { ...devices['Desktop Chrome'] }, testMatch: /screenshots\.spec\.ts/ },
  ],
});
