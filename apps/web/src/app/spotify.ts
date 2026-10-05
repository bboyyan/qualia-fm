/**
 * E 模式控制：接上／拔掉 Spotify 輸出、使用者點擊時接上播放器、重新偵測、改由 Spotify app 接手、
 * 退回手動、連結與中斷連結。SDK 只在 connectPlayer（使用者點擊）時載入。
 */
import type { SpotifyDevice } from '@qualia/contracts';
import { SpotifyConnectAdapter } from '../audio/adapters/spotifyConnectAdapter';
import { SpotifyWebPlaybackAdapter } from '../audio/adapters/spotifyWebPlaybackAdapter';
import { loadSpotifySdk } from '../audio/spotify/sdk';
import { browserTimers, documentVisibility, hasTransientActivation, type SpotifyRemote } from '../audio/spotify/types';
import { deviceStatus } from '../features/spotify/deviceStatus';
import { useAppStore } from './appStore';
import { api, getEngine, getRouter } from './services';

/** Qualia 網頁播放器在 Spotify 裝置清單上的名稱；路徑 C 的候選要排除它。 */
export const WEB_PLAYER_NAME = 'Qualia FM';

const remote: SpotifyRemote = {
  token: () => api.spotifyToken(),
  devices: () => api.spotifyDevices(),
  playback: () => api.spotifyPlayback(),
  play: (request) => api.spotifyPlay(request),
  pause: (deviceId) => api.spotifyPause(deviceId),
};

let webPlayer: SpotifyWebPlaybackAdapter | null = null;
let remoteDevice: SpotifyConnectAdapter | null = null;

function ensureWebPlayer(): SpotifyWebPlaybackAdapter {
  webPlayer ??= new SpotifyWebPlaybackAdapter({
    loadSdk: loadSpotifySdk,
    remote,
    timers: browserTimers,
    now: () => Date.now(),
    hasUserGesture: hasTransientActivation,
    visibility: documentVisibility,
    report: deviceStatus.set,
  });
  return webPlayer;
}

/** 依伺服器狀態接上（預設路徑 P）或拔掉 Spotify 輸出。不載 SDK。 */
export function syncSpotifyOutput(active: boolean): void {
  const router = getRouter();
  if (!active) {
    router.setSpotifyOutput(null);
    remoteDevice?.destroy();
    remoteDevice = null;
    deviceStatus.set(null);
    return;
  }
  if (!router.spotifyOutput) router.setSpotifyOutput(ensureWebPlayer());
}

/** 必須在使用者點擊的同步路徑內呼叫（activateElement）。路徑 C 時不需要。 */
export function connectPlayer(): Promise<boolean> {
  const output = getRouter().spotifyOutput;
  if (output && output !== webPlayer) return Promise.resolve(true);
  return ensureWebPlayer().connect();
}

/** ① 叫醒播放器：改回路徑 P，並在同一次點擊內重新開始目前這首（不跳歌）。 */
export function wakeWebPlayer(): void {
  const router = getRouter();
  if (router.spotifyOutput !== webPlayer) {
    router.setSpotifyOutput(ensureWebPlayer());
    remoteDevice?.destroy();
    remoteDevice = null;
  }
  getEngine().play();
}

/** 「重新偵測」：重新確認目前輸出；同時列出可接手的 Spotify app（排除本頁播放器）。 */
export async function redetect(fromGesture: boolean): Promise<{ online: boolean; devices: SpotifyDevice[] }> {
  const output = getRouter().spotifyOutput;
  const online = output ? await output.recheck(fromGesture) : false;
  const devices = await api.spotifyDevices().catch(() => [] as SpotifyDevice[]);
  return { online, devices: devices.filter((device) => device.name !== WEB_PLAYER_NAME) };
}

/** ② 讓 Spotify app 接手：改用路徑 C 遙控這台裝置，並重新開始目前這首。 */
export function handOverToDevice(device: SpotifyDevice): void {
  remoteDevice?.destroy();
  remoteDevice = new SpotifyConnectAdapter({
    remote,
    deviceId: device.id,
    deviceName: device.name,
    timers: browserTimers,
    now: () => Date.now(),
    hasUserGesture: hasTransientActivation,
    visibility: documentVisibility,
    report: deviceStatus.set,
  });
  getRouter().setSpotifyOutput(remoteDevice);
  deviceStatus.set({ path: 'C', state: 'online', deviceName: device.name, reason: null });
  getEngine().play();
}

/** ③ 最後退路：改成 B 手動播放（介紹與回饋照常）。 */
export function fallBackToManual(): void {
  const store = useAppStore.getState();
  store.setEMode('off');
  store.setSettings({ playbackMode: 'manual' });
}

/** 頂層導覽到伺服器 login（PKCE），由使用者在 Spotify 授權頁自己登入並同意。 */
export function beginSpotifyLink(): void {
  window.location.assign('/api/auth/spotify/login');
}

/** 中斷連結：伺服器刪除 token 檔；本頁拔掉 Spotify 輸出、回到手動，重新讀 capabilities。 */
export async function disconnectSpotify(): Promise<void> {
  await api.spotifyDisconnect();
  syncSpotifyOutput(false);
  const store = useAppStore.getState();
  store.setSettings({ playbackMode: 'manual' });
  store.setBoot('ready', await api.capabilities());
}
