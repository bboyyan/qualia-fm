/** 模式列三格：選曲／語音、播放、帳本（如實標示 MOCK／真 AI／Spotify）。 */
import type { ModeStripLabels } from './spotifyMode';
import styles from './spotify.module.css';

export function ModeStrip({ labels }: { labels: ModeStripLabels }) {
  return (
    <dl className={styles.strip} aria-label="目前模式" data-testid="mode-strip">
      <div>
        <dt>選曲／語音</dt>
        <dd>{labels.selection}</dd>
      </div>
      <div>
        <dt>播放</dt>
        <dd>{labels.playback}</dd>
      </div>
      <div>
        <dt>帳本</dt>
        <dd>{labels.ledger}</dd>
      </div>
    </dl>
  );
}
