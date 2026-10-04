import type { Phase } from '../../audio/types';
import { Button } from '../../ui/Button';
import styles from './feedback.module.css';

export function ManualControls({ phase, onStart, onFinish, onSkip }: { phase: Phase; onStart: () => void; onFinish: () => void; onSkip: () => void }) {
  return (
    <section className={styles.card} aria-label="B 手動播放">
      <p>請自行到 Spotify app 點歌。本站不知道播放進度，不控制 Spotify。</p>
      <div className={styles.actions}>
        {phase === 'manual_ready' && <Button block onClick={onStart}>我開始播了</Button>}
        {phase === 'manual_playing' && <>
          <p role="status">外部播放中（由你確認）</p>
          <Button block onClick={onFinish}>這首播完了</Button>
        </>}
        <Button block variant="outline" onClick={onSkip} data-testid="next">跳過這首</Button>
      </div>
    </section>
  );
}
