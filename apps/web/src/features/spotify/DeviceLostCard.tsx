/**
 * 裝置消失的友善提示（純呈現）：①叫醒網頁播放器（P）②讓 Spotify app 接手＋重新偵測（C）③改用手動（B）。
 * 以及「暫停超過 10 分鐘」先重新確認。沿用既有 InlineRecovery／Button。不用靜音保活或背景計時器。
 */
import type { SpotifyDevice } from '@qualia/contracts';
import { Button } from '../../ui/Button';
import { InlineRecovery } from '../../ui/Feedback';
import styles from './spotify.module.css';

interface DeviceLostStagesProps {
  title: string;
  position: string;
  /** null＝還沒按重新偵測。 */
  devices: readonly SpotifyDevice[] | null;
  detecting: boolean;
  onWake: () => void;
  onDetect: () => void;
  onHandOver: (device: SpotifyDevice) => void;
  onManual: () => void;
}

export function DeviceLostStages({ title, position, devices, detecting, onWake, onDetect, onHandOver, onManual }: DeviceLostStagesProps) {
  return (
    <InlineRecovery tone="offline" title="播放器睡著了" testId="device-lost">
      <p>iPhone 暫停一陣子或切到背景後，Spotify 常會把播放裝置收起來。這很常見，不是你按錯。照順序試就好：</p>
      <ol className={styles.stages}>
        <li className={styles.stage}>
          <small>① 網頁播放器</small>
          <h4>點一下叫醒</h4>
          <p>重新接上這個頁面裡的播放器。</p>
          <div className={styles.stageActions}>
            <Button block onClick={onWake} data-testid="wake-player">叫醒播放器</Button>
          </div>
        </li>
        <li className={styles.stage}>
          <small>② Spotify app</small>
          <h4>讓 Spotify app 接手</h4>
          <p>打開 Spotify，隨便播一首再暫停，回到這裡按「重新偵測」。</p>
          <div className={styles.stageActions}>
            <a className={styles.openLink} href="spotify:">打開 Spotify</a>
            <Button variant="outline" block loading={detecting} onClick={onDetect} data-testid="detect-devices">重新偵測</Button>
            {devices?.map((device) => (
              <Button key={device.id} variant="outline" block onClick={() => onHandOver(device)}>改由 {device.name} 播放</Button>
            ))}
            {devices?.length === 0 && <p role="status">還沒看到 Spotify app。請在 app 播一首再暫停，然後再按一次「重新偵測」。</p>}
          </div>
        </li>
        <li className={styles.stage}>
          <small>③ 最後退路 · 手動</small>
          <h4>改成手動播放</h4>
          <p>你自己在 Spotify 點〈{title}〉，Qualia 照樣介紹、照樣記回饋。</p>
          <div className={styles.stageActions}>
            <Button variant="outline" block onClick={onManual} data-testid="fallback-manual">改用手動播放</Button>
          </div>
        </li>
      </ol>
      <p className={styles.footnote}>停在{position}。我們不會用靜音音訊或背景計時器硬撐連線。</p>
    </InlineRecovery>
  );
}

interface PausedTooLongProps {
  title: string;
  position: string;
  onReconnect: () => void;
  onOther: () => void;
}

export function PausedTooLong({ title, position, onReconnect, onOther }: PausedTooLongProps) {
  return (
    <InlineRecovery
      tone="warning"
      title="暫停超過 10 分鐘了"
      testId="paused-too-long"
      actions={
        <>
          <Button block onClick={onReconnect} data-testid="reconnect-continue">重新接上並繼續</Button>
          <Button variant="text" block onClick={onOther}>接不上？看其他方法</Button>
        </>
      }
    >
      <p>Spotify 這段時間可能已經把播放器收起來。繼續之前，先幫你重新確認一次，不會直接亂播。</p>
      <p>停在{position}〈{title}〉。</p>
    </InlineRecovery>
  );
}
