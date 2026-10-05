/** E 模式的容器元件：把裝置狀態、重新偵測、三段退路、設定與中斷連結接到 app/spotify 控制。 */
import { useState } from 'react';
import type { SpotifyDevice } from '@qualia/contracts';
import { useAppStore } from '../../app/appStore';
import { getEngine } from '../../app/services';
import { beginSpotifyLink, disconnectSpotify, fallBackToManual, handOverToDevice, redetect, wakeWebPlayer } from '../../app/spotify';
import { currentItem } from '../../audio/queue';
import type { EngineState } from '../../audio/types';
import { DeviceLostStages, PausedTooLong } from './DeviceLostCard';
import { DeviceCardView } from './DeviceStatusView';
import { useDeviceStatus } from './deviceStatus';
import { SpotifyLinkView } from './SpotifySettings';

/** 播放頁底部的裝置卡＋「重新偵測」。 */
export function DevicePanel() {
  const status = useDeviceStatus();
  const [busy, setBusy] = useState(false);
  const showToast = useAppStore((s) => s.showToast);
  const onRedetect = () => {
    setBusy(true);
    redetect(true)
      .then(({ online }) => showToast(online ? '播放裝置在線上。' : '播放裝置目前不在，可以照提示叫醒或改由 Spotify app 接手。'))
      .catch(() => showToast('暫時無法確認播放裝置，請稍後再試。'))
      .finally(() => setBusy(false));
  };
  return <DeviceCardView status={status} busy={busy} onRedetect={onRedetect} />;
}

/** E 模式下「播放裝置不在」：暫停過久先重新確認；其他情況給三段退路。 */
export function SpotifyRecovery({ state }: { state: EngineState }) {
  const status = useDeviceStatus();
  const [showStages, setShowStages] = useState(false);
  const [devices, setDevices] = useState<readonly SpotifyDevice[] | null>(null);
  const [detecting, setDetecting] = useState(false);
  const showToast = useAppStore((s) => s.showToast);
  const item = currentItem(state);
  const title = item?.segment.candidate.title ?? '';
  const position = `第 ${state.currentIndex + 1}／${state.queue.length} 首`;
  if (status?.reason === 'paused_too_long' && !showStages) {
    // 在同一次點擊內重新開始這首：輸出會先重新接上（P）或重新確認裝置（C），再從原位置播放。
    return <PausedTooLong title={title} position={position} onReconnect={() => getEngine().play()} onOther={() => setShowStages(true)} />;
  }
  const onDetect = () => {
    setDetecting(true);
    redetect(false)
      .then((result) => setDevices(result.devices))
      .catch(() => setDevices([]))
      .finally(() => setDetecting(false));
  };
  const onManual = () => {
    fallBackToManual();
    showToast('已改成手動播放：請自己在 Spotify 點這首，介紹與回饋照常。');
  };
  return (
    <DeviceLostStages title={title} position={position} devices={devices} detecting={detecting} onWake={wakeWebPlayer} onDetect={onDetect} onHandOver={handOverToDevice} onManual={onManual} />
  );
}

/** 設定頁 E 模式區塊；只在伺服器啟用 Spotify 時出現。 */
export function SpotifySettingsSection() {
  const caps = useAppStore((s) => s.capabilities);
  const showToast = useAppStore((s) => s.showToast);
  const [disconnecting, setDisconnecting] = useState(false);
  if (!caps?.spotifyEnabled || !caps.spotify) return null;
  const onDisconnect = () => {
    setDisconnecting(true);
    getEngine().setPlaybackMode('manual');
    disconnectSpotify()
      .then(() => showToast('已中斷 Spotify 連結，授權檔已刪除，回到手動播放。'))
      .catch(() => showToast('中斷連結沒有完成，請再試一次。'))
      .finally(() => setDisconnecting(false));
  };
  return (
    <SpotifyLinkView
      linked={caps.spotify.linked}
      djApproved={caps.spotifyDjApproved}
      clientId={caps.spotify.clientId}
      redirectUri={caps.spotify.redirectUri}
      scopes={caps.spotify.scopes}
      disconnecting={disconnecting}
      onLink={beginSpotifyLink}
      onDisconnect={onDisconnect}
    />
  );
}
