import { BottomSheet } from '../ui/BottomSheet';
import { CapabilityBadge } from '../ui/Feedback';
import { useAppStore } from './appStore';
import styles from './shell.module.css';

/** "播放環境": the server's real capability report, verbatim. Opened from the MOCK badge. */
export function EnvironmentSheet() {
  const open = useAppStore((s) => s.sheet === 'environment');
  const closeSheet = useAppStore((s) => s.closeSheet);
  const caps = useAppStore((s) => s.capabilities);
  return (
    <BottomSheet open={open} title="播放環境" onClose={() => closeSheet()} testId="environment-sheet">
      <div className={styles.envHead}>
        <CapabilityBadge mode={caps?.mode ?? 'mock'} />
        <p>目前是示範模式：不連接任何音樂服務，也不呼叫 AI。</p>
      </div>
      <ul className={styles.envList}>
        {(caps?.restrictions ?? ['正在讀取播放環境…']).map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <dl className={styles.envFacts}>
        <div>
          <dt>Spotify</dt>
          <dd>{caps?.spotifyEnabled ? '已啟用' : '尚未啟用，需先完成整合核對'}</dd>
        </div>
        <div>
          <dt>背景／鎖屏</dt>
          <dd>{caps?.supportsBackground === 'tested-limited' ? '已實測，有限制' : '未驗證，不保證'}</dd>
        </div>
        <div>
          <dt>音量</dt>
          <dd>請使用裝置音量鍵</dd>
        </div>
      </dl>
    </BottomSheet>
  );
}
