/**
 * 串流時每首顯示封面＋Spotify 正式曲名／藝人＋Spotify 標示＋「在 Spotify 開啟」（Policy II.4／II.5）。
 * 封面與 metadata 只用於顯示，不進 AI、不進帳本。Spotify 官方 logo 素材待換（見 docs/spotify-e-mode.md）。
 */
import type { ResolvedTrack } from '@qualia/contracts';
import styles from './spotify.module.css';

interface SpotifyTrackCardProps {
  track: ResolvedTrack;
  /** 引擎已由 Spotify 狀態確認真的在播。 */
  confirmed: boolean;
}

export function SpotifyTrackCard({ track, confirmed }: SpotifyTrackCardProps) {
  const artists = track.canonicalArtists.join('、');
  return (
    <section className={styles.track} aria-label="Spotify 曲目資訊" data-testid="spotify-track">
      {track.artworkUrl ? (
        <img className={styles.cover} src={track.artworkUrl} width={96} height={96} alt={`${track.canonicalTitle} 封面（來自 Spotify）`} loading="eager" decoding="async" />
      ) : (
        <span className={styles.cover} aria-hidden="true" />
      )}
      <div className={styles.trackBody}>
        <h2>{track.canonicalTitle}</h2>
        <p>{artists}</p>
        <div className={styles.trackMeta}>
          <span className={styles.source}>Spotify</span>
          {confirmed && <span className={styles.confirmed} data-testid="audible-confirmed">已確認有聲音</span>}
          {track.externalUrl && (
            <a className={styles.openLink} href={track.externalUrl} target="_blank" rel="noopener noreferrer" data-testid="open-in-spotify">在 Spotify 開啟</a>
          )}
        </div>
      </div>
    </section>
  );
}
