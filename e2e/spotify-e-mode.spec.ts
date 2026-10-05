import { expect, test, type Page, type Route } from '@playwright/test';
import { expectNoHorizontalOverflow, generate } from './support';

/**
 * BRA-109 E 模式（Spotify 自動串接）。伺服器維持預設（SPOTIFY_* 全關）；E 模式的伺服器回應全部以
 * page.route 假造，Web Playback SDK 以 addInitScript 注入假的 window.Spotify。不連任何真實 Spotify。
 * Chromium 手機模擬不是 iPhone Safari；真機行為（G0-C）另列驗收。
 */

const LOVED = '0dF9anAJZv0IotD6lo2kl2';
const uriFor = (n: number): string => `spotify:track:E2Etrack${String(n).padStart(14, '0')}`;
const ARTWORK = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="%23294F42"/></svg>';

/** 假的 Spotify.Player：只回應測試指令（startPlaying／finish／goAway）。 */
const FAKE_SDK = () => {
  type Listener = (payload: unknown) => void;
  interface FakeState { paused: boolean; position: number; duration: number; track_window: { current_track: { uri: string } | null; previous_tracks: { uri: string }[] } }
  class FakePlayer {
    private readonly listeners = new Map<string, Listener[]>();
    private state: FakeState | null = null;
    constructor(readonly options: { name: string; getOAuthToken: (cb: (token: string) => void) => void }) {
      (window as unknown as { __fakeSpotify: FakePlayer }).__fakeSpotify = this;
    }
    addListener(event: string, listener: Listener): boolean {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      return true;
    }
    removeListener(event: string): boolean {
      this.listeners.delete(event);
      return true;
    }
    emit(event: string, payload?: unknown): void {
      for (const listener of this.listeners.get(event) ?? []) listener(payload);
    }
    connect(): Promise<boolean> {
      this.options.getOAuthToken(() => undefined);
      window.setTimeout(() => this.emit('ready', { device_id: 'E2EwebPlayer' }), 30);
      return Promise.resolve(true);
    }
    disconnect(): void {}
    activateElement(): Promise<void> {
      return Promise.resolve();
    }
    getCurrentState(): Promise<FakeState | null> {
      return Promise.resolve(this.state);
    }
    pause(): Promise<void> {
      if (this.state) this.setState({ ...this.state, paused: true });
      return Promise.resolve();
    }
    resume(): Promise<void> {
      if (this.state) this.setState({ ...this.state, paused: false });
      return Promise.resolve();
    }
    seek(): Promise<void> {
      return Promise.resolve();
    }
    startPlaying(uri: string): void {
      this.setState({ paused: false, position: 0, duration: 6000, track_window: { current_track: { uri }, previous_tracks: [] } });
    }
    finish(uri: string): void {
      this.setState({ paused: true, position: 0, duration: 6000, track_window: { current_track: { uri: 'spotify:track:E2Eafter0000000000000' }, previous_tracks: [{ uri }] } });
    }
    goAway(): void {
      this.emit('not_ready', { device_id: 'E2EwebPlayer' });
    }
    private setState(state: FakeState): void {
      this.state = state;
      this.emit('player_state_changed', state);
    }
  }
  (window as unknown as { Spotify: unknown }).Spotify = { Player: FakePlayer };
};

const fake = (page: Page, call: 'startPlaying' | 'finish' | 'goAway', uri = '') =>
  page.evaluate(([name, value]) => {
    const player = (window as unknown as { __fakeSpotify?: Record<string, (uri: string) => void> }).__fakeSpotify;
    player?.[name]?.(value);
  }, [call, uri] as const);

interface FakeServer {
  linked: boolean;
  plays: { uri: string; deviceId: string; speechSilent: boolean }[];
  loved: unknown[];
  devices: { id: string; name: string; type: string; isActive: boolean }[];
}

/** 假造 E 模式的伺服器：capabilities（核可＋連結狀態）、Spotify 對應後的節目、token／播放代理／Loved。 */
async function fakeEModeServer(page: Page, options: { linked: boolean }): Promise<FakeServer> {
  const server: FakeServer = { linked: options.linked, plays: [], loved: [], devices: [] };
  await page.addInitScript(FAKE_SDK);
  await page.route('**/api/capabilities', async (route) => {
    const response = await route.fetch();
    const caps = await response.json();
    await route.fulfill({ response, json: {
      ...caps,
      spotifyEnabled: true,
      spotifyDjApproved: true,
      spotify: { linked: server.linked, clientId: 'E2Eclientid00000', redirectUri: 'https://qualia.example.test/callback', lovedPlaylistId: LOVED, scopes: ['streaming'] },
    } });
  });
  await page.route('**/api/shows/*', async (route) => {
    const response = await route.fetch();
    const show = await response.json();
    const segments = show.segments.map((segment: { track: Record<string, unknown> }, i: number) => ({
      ...segment,
      track: {
        ...segment.track,
        provider: 'spotify',
        providerTrackId: `E2Etrack${i + 1}`,
        canonicalTitle: `E2E 正式曲名 ${i + 1}`,
        canonicalArtists: ['E2E 藝人'],
        artworkUrl: ARTWORK,
        durationMs: 6000,
        externalUrl: `https://open.spotify.com/track/E2Etrack${i + 1}`,
        audioLocator: { kind: 'spotify_uri', uri: uriFor(i + 1) },
      },
    }));
    await route.fulfill({ response, json: { ...show, segments } });
  });
  await page.route('**/api/spotify/token', (route) => route.fulfill({ json: { accessToken: 'E2E-fake-token', expiresAt: new Date(Date.now() + 3600_000).toISOString() } }));
  await page.route('**/api/spotify/pause', (route) => route.fulfill({ status: 204 }));
  await page.route('**/api/spotify/devices', (route) => route.fulfill({ json: { devices: server.devices } }));
  await page.route('**/api/spotify/play', async (route: Route) => {
    const body = route.request().postDataJSON() as { uri: string; deviceId: string };
    // 送出 play 的那一刻，介紹語音必須已經停了（不疊、不 ducking）。
    const speechSilent = await page.evaluate(() => [...document.querySelectorAll('audio')].every((audio) => audio.paused));
    server.plays.push({ uri: body.uri, deviceId: body.deviceId, speechSilent });
    await route.fulfill({ status: 204 });
  });
  await page.route('**/api/spotify/loved', async (route) => {
    server.loved.push(route.request().postDataJSON());
    await route.fulfill({ json: { status: 'added', playlistId: LOVED } });
  });
  return server;
}

async function startEModeShow(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('mode-badge')).toContainText('Spotify');
  await generate(page, 'TEST seed');
  await page.getByTestId('start-listening').click();
  await expect(page.getByTestId('listen-page')).toBeVisible();
}

/** 等介紹播完、Spotify 收到 play，再讓假 SDK 回報真的在播。 */
async function reachPlaying(page: Page, server: FakeServer): Promise<string> {
  await expect.poll(() => server.plays.length, { timeout: 10_000 }).toBeGreaterThan(0);
  const uri = server.plays.at(-1)?.uri ?? '';
  await expect(page.getByTestId('audible-confirmed')).toHaveCount(0);
  await fake(page, 'startPlaying', uri);
  await expect(page.getByTestId('audible-confirmed')).toBeVisible();
  return uri;
}

test.describe('BRA-109 E 模式（假 Spotify）', () => {
  test('E 模式關閉（預設伺服器）時與現在相同：E 停用、沒有 Spotify 區塊、不載 SDK、登入被擋', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByTestId('mode-badge')).toContainText('MOCK');
    await page.getByTestId('tab-settings').click();
    await expect(page.getByRole('radio', { name: 'E · Spotify 自動串接' })).toBeDisabled();
    await expect(page.getByText('需曄當次明確同意，預設關閉', { exact: true })).toBeVisible();
    await expect(page.getByTestId('e-mode-settings')).toHaveCount(0);
    await expect(page.getByTestId('mode-strip')).toHaveCount(0);
    expect(await page.locator('script[src*="sdk.scdn.co"]').count()).toBe(0);
    const login = await request.get('/api/auth/spotify/login', { maxRedirects: 0 });
    expect(login.status()).toBe(403);
    const health = await request.get('/api/health');
    expect(health.headers()['content-security-policy']).not.toContain('sdk.scdn.co');
  });

  test('登入流程（假）：同意 sheet → 伺服器 login → /callback → 回到 App 顯示已連結', async ({ page }) => {
    const server = await fakeEModeServer(page, { linked: false });
    await page.route('**/api/auth/spotify/login', (route) => route.fulfill({ status: 302, headers: { Location: '/callback?code=E2E-code&state=E2E-state' } }));
    await page.route(/\/callback\?/, (route) => {
      server.linked = true;
      return route.fulfill({ status: 303, headers: { Location: '/?spotify=linked' } });
    });
    await page.goto('/');
    await page.getByTestId('tab-settings').click();
    await expect(page.getByTestId('spotify-link-state')).toHaveText('未連結');
    await expect(page.getByTestId('disconnect-spotify')).toBeDisabled();
    await page.getByTestId('open-consent').click();
    const consent = page.getByTestId('e-mode-consent');
    await expect(consent).toContainText('這是本專案內部的授權，不等於 Spotify 官方核可這個用途。');
    await consent.getByTestId('consent-link').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('toast').first()).toContainText('已連結 Spotify');
    await expect(page.getByTestId('spotify-link-state')).toHaveText('已連結');
    await expect(page.getByRole('radio', { name: 'E · Spotify 自動串接' })).toBeChecked();
    await expectNoHorizontalOverflow(page);
  });

  test('介紹先播完、確認已停才送 play；以狀態確認在播才顯示「已確認有聲音」', async ({ page }) => {
    const server = await fakeEModeServer(page, { linked: true });
    await startEModeShow(page);
    await expect(page.getByTestId('dj-strip')).toBeVisible();
    expect(server.plays).toEqual([]);
    await reachPlaying(page, server);
    expect(server.plays[0]).toMatchObject({ uri: uriFor(1), deviceId: 'E2EwebPlayer', speechSilent: true });
    const card = page.getByTestId('spotify-track');
    await expect(card).toContainText('E2E 正式曲名 1');
    await expect(card).toContainText('Spotify');
    await expect(card.getByTestId('open-in-spotify')).toHaveAttribute('href', 'https://open.spotify.com/track/E2Etrack1');
    await expect(page.getByTestId('phase-label')).toContainText('Spotify 播放中・已確認有聲音');
    await expect(page.getByTestId('device-status').first()).toContainText('已接上');
    await expectNoHorizontalOverflow(page);
  });

  test('裝置消失：三段提示（叫醒播放器 → Spotify app 接手＋重新偵測 → 手動）', async ({ page }) => {
    const server = await fakeEModeServer(page, { linked: true });
    await startEModeShow(page);
    await reachPlaying(page, server);
    await fake(page, 'goAway');
    const lost = page.getByTestId('device-lost');
    await expect(lost).toBeVisible();
    await expect(lost.getByTestId('wake-player')).toBeVisible();
    await expect(lost.getByRole('link', { name: '打開 Spotify' })).toHaveAttribute('href', 'spotify:');
    await expect(lost.getByTestId('fallback-manual')).toBeVisible();
    await expect(lost).toContainText('不會用靜音音訊或背景計時器硬撐連線');
    await lost.getByTestId('detect-devices').click();
    await expect(lost).toContainText('還沒看到 Spotify app');
    server.devices = [{ id: 'E2Ephone', name: 'E2E iPhone', type: 'Smartphone', isActive: false }];
    await lost.getByTestId('detect-devices').click();
    await expect(lost.getByRole('button', { name: '改由 E2E iPhone 播放' })).toBeVisible();
    const plays = server.plays.length;
    await lost.getByTestId('wake-player').click();
    await expect.poll(() => server.plays.length).toBe(plays + 1);
    expect(server.plays.at(-1)).toMatchObject({ uri: uriFor(1) });
    await expectNoHorizontalOverflow(page);
  });

  test('愛 → 確認 sheet → 加入 Qualia Loved（假）→ 結果 → 繼續下一首', async ({ page }) => {
    const server = await fakeEModeServer(page, { linked: true });
    await startEModeShow(page);
    const uri = await reachPlaying(page, server);
    await fake(page, 'finish', uri);
    const form = page.getByTestId('feedback-card');
    await form.getByRole('button', { name: '愛', exact: true }).click();
    await form.getByRole('button', { name: '送出回饋', exact: true }).click();
    const sheet = page.getByTestId('love-confirm');
    await expect(sheet).toContainText('加入你的 Qualia Loved？');
    await expect(sheet).toContainText(LOVED);
    expect(server.loved).toEqual([]);
    await sheet.getByTestId('love-add').click();
    const result = page.getByTestId('love-result');
    await expect(result).toContainText('已加入 Qualia Loved');
    await expect(result).toContainText('TEST 假帳本已寫入');
    expect(server.loved).toHaveLength(1);
    expect(Object.keys(server.loved[0] as object).sort()).toEqual(['segmentId', 'showId']);
    await result.getByTestId('love-continue').click();
    await expect(page.getByTestId('count-pill')).toHaveText('02 / 05');
  });

  test('愛 → 選「只在帳本記愛」不呼叫 Loved', async ({ page }) => {
    const server = await fakeEModeServer(page, { linked: true });
    await startEModeShow(page);
    const uri = await reachPlaying(page, server);
    await fake(page, 'finish', uri);
    const form = page.getByTestId('feedback-card');
    await form.getByRole('button', { name: '愛', exact: true }).click();
    await form.getByRole('button', { name: '送出回饋', exact: true }).click();
    await page.getByTestId('love-skip').click();
    await expect(page.getByTestId('love-result')).toContainText('只記在帳本');
    expect(server.loved).toEqual([]);
  });
});
