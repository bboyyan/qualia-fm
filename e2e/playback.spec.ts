import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, expectNotCoveredByBottomBar, expectOnFirstScreen, generate, openApp, skipFeedback } from './support';

/**
 * Audio probe: counts every <audio> ever created and the maximum number of media elements
 * playing at the same moment. `__qfmBlockNextPlay` makes the next play() reject exactly like a
 * mobile autoplay block (NotAllowedError) so the real recovery path is exercised.
 */
const PROBE = () => {
  const probe = { created: 0, maxPlaying: 0 };
  (window as unknown as { __qfm: typeof probe }).__qfm = probe;
  const create = Document.prototype.createElement;
  Document.prototype.createElement = function (this: Document, tag: string, options?: ElementCreationOptions) {
    if (String(tag).toLowerCase() === 'audio') probe.created += 1;
    return create.call(this, tag, options);
  } as typeof Document.prototype.createElement;
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    const w = window as unknown as { __qfmBlockNextPlay?: boolean };
    if (w.__qfmBlockNextPlay) {
      w.__qfmBlockNextPlay = false;
      return Promise.reject(new DOMException('blocked by test', 'NotAllowedError'));
    }
    return play.call(this);
  };
  document.addEventListener(
    'playing',
    () => {
      const playing = [...document.querySelectorAll('audio, video')].filter((m) => !(m as HTMLMediaElement).paused).length;
      probe.maxPlaying = Math.max(probe.maxPlaying, playing);
    },
    true,
  );
};

const probe = (page: Page) => page.evaluate(() => (window as unknown as { __qfm: { created: number; maxPlaying: number } }).__qfm);
const elapsed = (page: Page) => page.getByTestId('elapsed').innerText();

async function startListening(page: Page): Promise<void> {
  await page.addInitScript(PROBE);
  await openApp(page, 'mock');
  await generate(page);
  await page.getByTestId('start-listening').click();
  await expect(page.getByTestId('listen-page')).toBeVisible();
}

async function waitForTrack(page: Page): Promise<void> {
  await expect(page.getByTestId('phase-label')).toContainText('MOCK 合成測試音播放中', { timeout: 10_000 });
}

test.describe('T04 播放引擎', () => {
  test('start plays the DJ chime then the MOCK track of the same segment, progress moves', async ({ page }) => {
    await startListening(page);
    await expect(page.getByTestId('track-title')).toHaveText('微光偏航');
    await expect(page.getByTestId('dj-strip')).toContainText('MOCK 提示音，非 AI 語音');
    await expectNoHorizontalOverflow(page);
    await expectOnFirstScreen(page, 'play-toggle');
    await waitForTrack(page);
    await expect(page.getByTestId('track-title')).toHaveText('微光偏航');
    await expect(page.getByText('MOCK 虛構曲目')).toBeVisible();
    const before = await elapsed(page);
    await expect.poll(() => elapsed(page), { timeout: 4_000 }).not.toBe(before);
    await expectNoHorizontalOverflow(page);
    await expectOnFirstScreen(page, 'play-toggle');
    await expectNotCoveredByBottomBar(page, 'open-tune');
  });

  test('pause freezes progress; resume does not replay the intro (AC14)', async ({ page }) => {
    await startListening(page);
    await page.getByTestId('skip-intro').click();
    await waitForTrack(page);
    await page.waitForTimeout(1_200);
    await page.getByTestId('play-toggle').click();
    await expect(page.getByTestId('phase-label')).toContainText('已暫停');
    const frozen = await elapsed(page);
    await page.waitForTimeout(1_300);
    expect(await elapsed(page)).toBe(frozen);
    await page.getByTestId('play-toggle').click();
    await waitForTrack(page);
    await expect(page.getByTestId('dj-strip')).toHaveCount(0);
  });

  test('skip intro keeps the same song (AC12)', async ({ page }) => {
    await startListening(page);
    await page.getByTestId('skip-intro').click();
    await waitForTrack(page);
    await expect(page.getByTestId('track-title')).toHaveText('微光偏航');
  });

  test('rapid next taps never double-play and use a single audio element (AC13, AC23)', async ({ page }) => {
    await startListening(page);
    // 介紹中按下一首：還沒聽到曲目，直接往下、不問回饋（BRA-117）。
    for (let i = 0; i < 3; i += 1) await page.getByTestId('next').click();
    await expect(page.getByTestId('track-title')).toHaveText('低空漂浮');
    await page.waitForTimeout(800);
    const p = await probe(page);
    expect(p.created).toBe(1);
    expect(p.maxPlaying).toBeLessThanOrEqual(1);
  });

  test('restart replays the track from 0 without the intro (AC15)', async ({ page }) => {
    await startListening(page);
    await page.getByTestId('skip-intro').click();
    await waitForTrack(page);
    await page.waitForTimeout(2_200);
    await page.getByTestId('restart').click();
    await waitForTrack(page);
    expect(await elapsed(page)).toMatch(/^0:0[01]$/);
    await expect(page.getByTestId('dj-strip')).toHaveCount(0);
  });

  test('natural end advances once and shows the transition bridge; next-skip shows the seed bridge (AC18, AC21)', async ({ page }) => {
    await startListening(page);
    await page.getByTestId('skip-intro').click();
    await expect(page.getByTestId('feedback-card')).toBeVisible({ timeout: 12_000 });
    await expect(page.getByTestId('track-title')).toHaveText('微光偏航');
    await skipFeedback(page);
    await expect(page.getByTestId('track-title')).toHaveText('雨後的底片');
    await expect(page.getByTestId('bridge-card')).toHaveAttribute('data-bridge-kind', 'transition');
    await expect(page.getByTestId('bridge-card')).toContainText('接續：微光偏航 → 這一首');
    await expect(page.getByTestId('count-pill')).toHaveText('02 / 05');
    // 第 2 首還在介紹，沒聽到曲目：直接往下，不問回饋（BRA-117）。
    await page.getByTestId('next').click();
    await expect(page.getByTestId('feedback-card')).toHaveCount(0);
    await expect(page.getByTestId('track-title')).toHaveText('柔焦公路');
    await expect(page.getByTestId('bridge-card')).toHaveAttribute('data-bridge-kind', 'seed');
  });

  test('autoplay rejection shows a tap-to-resume control and no hidden retry (AC24)', async ({ page }) => {
    await page.addInitScript(() => ((window as unknown as { __qfmBlockNextPlay: boolean }).__qfmBlockNextPlay = true));
    await startListening(page);
    await expect(page.getByTestId('autoplay-blocked')).toContainText('點一下，繼續這段節目');
    await page.waitForTimeout(1_000);
    await expect(page.getByTestId('autoplay-blocked')).toBeVisible();
    await page.getByTestId('tap-to-resume').click();
    await expect(page.getByTestId('autoplay-blocked')).toHaveCount(0);
    await expect(page.getByTestId('track-title')).toHaveText('微光偏航');
  });

  test('switching tabs keeps the same audio element playing (AC23)', async ({ page }) => {
    await startListening(page);
    await page.getByTestId('skip-intro').click();
    await waitForTrack(page);
    await page.evaluate(() => (document.querySelector('audio') as HTMLAudioElement).setAttribute('data-e2e-mark', 'same'));
    await page.getByTestId('tab-home').click();
    await page.getByTestId('tab-settings').click();
    await page.getByTestId('tab-listen').click();
    const audio = await page.evaluate(() => {
      const el = document.querySelector('audio') as HTMLAudioElement;
      return { mark: el.getAttribute('data-e2e-mark'), paused: el.paused, count: document.querySelectorAll('audio').length };
    });
    expect(audio).toEqual({ mark: 'same', paused: false, count: 1 });
  });

  test('device loss while on Settings does not rewind progress after reconnect (B1)', async ({ page }) => {
    const currentTime = () => page.evaluate(() => (document.querySelector('audio') as HTMLAudioElement).currentTime);
    const toSeconds = (text: string) => text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
    // One engine tick (250ms) of staleness plus media-clock jitter.
    const toleranceS = 0.5;
    await startListening(page);
    await page.getByTestId('skip-intro').click();
    await waitForTrack(page);
    await expect.poll(currentTime, { timeout: 4_000 }).toBeGreaterThanOrEqual(1);
    await page.getByTestId('tab-settings').click();
    const leftListenAt = await currentTime();
    // Keep playing away from the player long enough that losing the off-tab progress is visible.
    await expect.poll(currentTime, { timeout: 4_000 }).toBeGreaterThanOrEqual(leftListenAt + 1.5);
    const lostAt = await currentTime();
    await page.getByTestId('simulate-device-lost').click();
    await expect(page.getByTestId('playback-error')).toContainText('播放裝置目前未連線');
    // Installed while the output is silent, so it records exactly where the reconnect starts.
    await page.evaluate(() => {
      const audio = document.querySelector('audio') as HTMLAudioElement;
      const w = window as unknown as { __qfmResumedAt?: number };
      audio.addEventListener('playing', () => (w.__qfmResumedAt = audio.currentTime), { once: true });
    });
    await page.getByRole('button', { name: '重新連線' }).click();
    await waitForTrack(page);
    const resumedAt = await page.evaluate(() => (window as unknown as { __qfmResumedAt?: number }).__qfmResumedAt);
    expect(resumedAt).toBeGreaterThanOrEqual(lostAt - toleranceS);
    expect(toSeconds(await elapsed(page))).toBeGreaterThanOrEqual(Math.floor(lostAt - toleranceS));
    expect((await probe(page)).maxPlaying).toBeLessThanOrEqual(1);
  });
});
