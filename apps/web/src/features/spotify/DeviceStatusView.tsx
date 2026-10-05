/** 裝置狀態小元件（常駐但不搶畫面）＋裝置卡「重新偵測」。純呈現，資料由容器提供。 */
import type { DeviceState, SpotifyDeviceStatus } from '../../audio/spotify/types';
import { Button } from '../../ui/Button';
import styles from './spotify.module.css';

const STATE_LABEL: Record<DeviceState, string> = {
  idle: '尚未接上',
  connecting: '接上中',
  online: '已接上',
  offline: '已離線',
};

const pathLabel = (status: SpotifyDeviceStatus | null): string =>
  status?.path === 'C' ? `${status.deviceName ?? 'Spotify app'}・路徑 C` : 'Qualia 網頁播放器・路徑 P';

export function DeviceStatusPill({ status }: { status: SpotifyDeviceStatus | null }) {
  const state = status?.state ?? 'idle';
  return (
    <span className={styles.pill} data-state={state} data-testid="device-status" role="status">
      <span className={styles.dot} aria-hidden="true" />
      {STATE_LABEL[state]}
    </span>
  );
}

interface DeviceCardViewProps {
  status: SpotifyDeviceStatus | null;
  busy: boolean;
  onRedetect: () => void;
}

export function DeviceCardView({ status, busy, onRedetect }: DeviceCardViewProps) {
  return (
    <section className={styles.deviceCard} aria-label="播放裝置" data-testid="device-card">
      <p>
        <strong>{pathLabel(status)}</strong>
        <DeviceStatusPill status={status} />
      </p>
      <Button variant="text" loading={busy} onClick={onRedetect} data-testid="redetect">
        重新偵測
      </Button>
    </section>
  );
}
