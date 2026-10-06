import { useState } from 'react';
import { Icon } from '../../ui/Icon';
import styles from './songs.module.css';

/** 固定大小與同一佔位；網路失敗不留下破圖圖示。 */
export function SongArtworkView({ url, title, failed, onError }: { url?: string | null; title: string; failed: boolean; onError: () => void }) {
  return url && !failed ? (
    <img className={styles.artwork} src={url} width={64} height={64} alt={`${title} 封面（來自 Spotify）`} decoding="async" onError={onError} data-testid="song-artwork" />
  ) : (
    <span className={`${styles.artwork} ${styles.artworkPlaceholder}`} role="img" aria-label="暫無專輯封面" data-testid="song-artwork-placeholder"><Icon name="song" size={24} /></span>
  );
}

export function SongArtwork({ url, title }: { url?: string | null; title: string }) {
  const [failed, setFailed] = useState(false);
  return <SongArtworkView url={url} title={title} failed={failed} onError={() => setFailed(true)} />;
}
