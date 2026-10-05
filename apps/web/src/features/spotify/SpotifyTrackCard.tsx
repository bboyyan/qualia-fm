/**
 * 串流時每首顯示封面＋Spotify 正式曲名／歌手／專輯＋Spotify 完整官方 logo＋「在 Spotify 開啟」（Policy II.4／II.5、
 * Spotify Design Guidelines：完整 logo（圖示＋字標）、官方素材、留白、封面圓角 4／8px、使用者一定能看到完整 metadata）。
 * 封面與 metadata 只用於顯示，不進 AI、不進帳本。
 */
import { useId, useState } from 'react';
import type { ResolvedTrack } from '@qualia/contracts';
import styles from './spotify.module.css';

/**
 * 官方素材原檔（未修改）：Spotify Newsroom 媒體包「2024 Spotify Brand Assets」的 Spotify_Full_Logo_RGB_Green.png
 * （3432×940）。來源、雜湊與使用條件見 docs/spotify-e-mode.md「Spotify 標示素材」。
 * 顯示寬 80px（數位最小 70px），高度依原比例。
 */
export const SPOTIFY_LOGO = { src: '/brand/spotify/Spotify_Full_Logo_RGB_Green.png', width: 80, height: 22 } as const;

interface SpotifyTrackCardProps {
  track: ResolvedTrack;
  /** 引擎已由 Spotify 狀態確認真的在播。 */
  confirmed: boolean;
}

interface SpotifyTrackCardViewProps extends SpotifyTrackCardProps {
  /** 展開時曲名／歌手／專輯換行顯示全文。 */
  expanded: boolean;
  onToggle: () => void;
}

export function SpotifyTrackCardView({ track, confirmed, expanded, onToggle }: SpotifyTrackCardViewProps) {
  const metaId = useId();
  const artists = track.canonicalArtists.join('、');
  return (
    <section className={styles.track} aria-label="Spotify 曲目資訊" data-testid="spotify-track">
      {track.artworkUrl ? (
        <img className={styles.cover} src={track.artworkUrl} width={96} height={96} alt={`${track.canonicalTitle} 封面（來自 Spotify）`} loading="eager" decoding="async" />
      ) : (
        <span className={styles.cover} aria-hidden="true" />
      )}
      <div className={styles.trackBody}>
        <div id={metaId} className={styles.trackText} data-expanded={expanded ? 'true' : 'false'}>
          <h2 title={track.canonicalTitle}>{track.canonicalTitle}</h2>
          <p title={artists}>{artists}</p>
          {track.canonicalAlbum && <p className={styles.album} title={track.canonicalAlbum} data-testid="spotify-album">{track.canonicalAlbum}</p>}
        </div>
        <button type="button" className={styles.metaToggle} aria-expanded={expanded} aria-controls={metaId} onClick={onToggle} data-testid="spotify-meta-toggle">
          {expanded ? '收合曲目資訊' : '顯示完整曲目資訊'}
        </button>
        <div className={styles.trackMeta}>
          <span className={styles.brand}>
            <img src={SPOTIFY_LOGO.src} width={SPOTIFY_LOGO.width} height={SPOTIFY_LOGO.height} alt="Spotify" decoding="async" data-testid="spotify-logo" />
          </span>
          {confirmed && <span className={styles.confirmed} data-testid="audible-confirmed">已確認有聲音</span>}
          {track.externalUrl && (
            <a className={styles.openLink} href={track.externalUrl} target="_blank" rel="noopener noreferrer" data-testid="open-in-spotify">在 Spotify 開啟</a>
          )}
        </div>
      </div>
    </section>
  );
}

export function SpotifyTrackCard(props: SpotifyTrackCardProps) {
  const [expanded, setExpanded] = useState(false);
  return <SpotifyTrackCardView {...props} expanded={expanded} onToggle={() => setExpanded((value) => !value)} />;
}
