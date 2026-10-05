/**
 * 串流時每首顯示封面＋Spotify 正式曲名／歌手／專輯＋Spotify 官方圖示＋「在 Spotify 開啟」（Policy II.4／II.5、
 * Spotify Design Guidelines：完整 metadata、官方圖示與留白、封面圓角 4／8px）。
 * 封面與 metadata 只用於顯示，不進 AI、不進帳本。
 */
import type { ResolvedTrack } from '@qualia/contracts';
import styles from './spotify.module.css';

interface SpotifyTrackCardProps {
  track: ResolvedTrack;
  /** 引擎已由 Spotify 狀態確認真的在播。 */
  confirmed: boolean;
}

/** Spotify Green（官方主色）；圖示只用官方配色，不套站內色票。 */
const SPOTIFY_GREEN = '#1ED760';
/** 數位使用的最小圖示尺寸。 */
const LOGO_PX = 21;
/** Spotify 官方圖示（圓形＋三道聲波）。啟用前需與 Spotify for Developers 下載的官方素材比對（見 docs/spotify-e-mode.md）。 */
const SPOTIFY_ICON_PATH =
  'M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z';

function SpotifyLogo() {
  return (
    <span className={styles.brand}>
      <svg data-testid="spotify-logo" role="img" aria-label="Spotify" width={LOGO_PX} height={LOGO_PX} viewBox="0 0 24 24" fill={SPOTIFY_GREEN} focusable="false">
        <path d={SPOTIFY_ICON_PATH} />
      </svg>
    </span>
  );
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
        {track.canonicalAlbum && <p className={styles.album} data-testid="spotify-album">{track.canonicalAlbum}</p>}
        <div className={styles.trackMeta}>
          <SpotifyLogo />
          {confirmed && <span className={styles.confirmed} data-testid="audible-confirmed">已確認有聲音</span>}
          {track.externalUrl && (
            <a className={styles.openLink} href={track.externalUrl} target="_blank" rel="noopener noreferrer" data-testid="open-in-spotify">在 Spotify 開啟</a>
          )}
        </div>
      </div>
    </section>
  );
}
