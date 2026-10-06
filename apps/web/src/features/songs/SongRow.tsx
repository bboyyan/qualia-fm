/**
 * 「我的歌」的一列：曲名／藝人、最近評價，三個狀態鈕（收藏／釘選／封鎖）、當種子開台，
 * 以及可展開的最近幾筆帳本紀錄。封鎖的歌只留「封鎖」鈕（再按一次解除）與紀錄。
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { SongDisplay, TrackMark } from '@qualia/contracts';
import { SPOTIFY_LOGO } from '../spotify/SpotifyTrackCard';
import { SongArtwork } from './SongArtwork';
import { Icon, type IconName } from '../../ui/Icon';
import { entryLabel, entryNote, isBlocked, isLoved, isPinned, ratingSummary, shortTime, type SongAction } from './mySongs';
import type { HistoryState } from './mySongsModel';
import styles from './songs.module.css';

interface ToggleProps {
  icon: IconName;
  label: string;
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
  describedBy?: string;
}

function Toggle({ icon, label, pressed, disabled, onClick, describedBy }: ToggleProps) {
  return (
    <button type="button" className={styles.toggle} aria-pressed={pressed} aria-describedby={describedBy} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={18} />
      {label}
    </button>
  );
}

function History({ id, history, onRetry }: { id: string; history: HistoryState | undefined; onRetry: () => void }) {
  if (!history || history.status === 'loading') {
    return <p id={id} className={styles.historyNote}>讀取紀錄中…</p>;
  }
  if (history.status === 'error') {
    return (
      <p id={id} className={styles.historyNote} role="alert">
        讀不到這首的紀錄。
        <button type="button" className={styles.inlineLink} onClick={onRetry}>
          再試一次
        </button>
      </p>
    );
  }
  return (
    <ol id={id} className={styles.history} aria-label="最近的帳本紀錄" data-testid="song-history">
      {history.entries.map((entry) => {
        const note = entryNote(entry);
        return (
          <li key={entry.entryId}>
            <time dateTime={entry.at}>{shortTime(entry.at)}</time>
            <span>
              {entryLabel(entry)}
              {note && <span data-song-data>・「{note}」</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export interface SongRowProps {
  song: TrackMark;
  display?: SongDisplay;
  onVisible?: (trackKey: string) => void;
  /** 釘選名額已滿（這首未釘選時按下只會提示）。 */
  pinFull: boolean;
  busy: boolean;
  disabled: boolean;
  history: HistoryState | undefined;
  onAction: (action: SongAction, on: boolean) => void;
  onSeed: () => void;
  onLoadHistory: () => void;
}

export function SongRow({ song, display, onVisible, pinFull, busy, disabled, history, onAction, onSeed, onLoadHistory }: SongRowProps) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const rowRef = useRef<HTMLLIElement>(null);
  const metadata = display?.status === 'available' ? display.metadata : undefined;
  const title = metadata?.canonicalTitle ?? song.title;
  const artist = metadata?.canonicalArtists.join('、') ?? song.artist;
  useEffect(() => {
    const row = rowRef.current;
    if (!row || !onVisible) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onVisible(song.trackKey);
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, [song.trackKey, onVisible]);
  const blocked = isBlocked(song);
  const pinned = isPinned(song);
  const rating = ratingSummary(song);
  // 展開中且紀錄被動作清掉（或第一次展開）時讀取。
  useEffect(() => {
    if (expanded && !history) onLoadHistory();
  }, [expanded, history, onLoadHistory]);

  return (
    <li ref={rowRef} className={styles.row} data-state={blocked ? 'blocked' : pinned ? 'pinned' : undefined} data-testid="song-row" aria-busy={busy || undefined}>
      <div className={styles.rowHead}>
        <SongArtwork key={metadata?.artworkUrl ?? 'none'} url={metadata?.artworkUrl} title={title} />
        <div className={styles.rowText}>
          <h3 className={styles.title} title={title} data-song-data>
            {title}
          </h3>
          <p className={styles.artist} title={artist} data-song-data>
            {artist}
          </p>
          <div className={styles.statuses}>
            {!blocked && isLoved(song) && <span className={styles.tag}>收藏</span>}
            {pinned && <span className={styles.tag}>釘選</span>}
            {blocked && <span className={`${styles.tag} ${styles.tagBlocked}`}>已封鎖</span>}
          </div>
        </div>
      </div>
      {metadata && <span className={styles.spotifyBrand}><img {...SPOTIFY_LOGO} alt="Spotify" decoding="async" data-testid="spotify-logo" /></span>}
      <p className={styles.meta} data-testid="song-rating">
        {rating ? (
          <>
            最近評價：<strong data-song-data>{rating}</strong>
          </>
        ) : (
          '還沒評價'
        )}
        {song.lastAiredAt && <span> · 播出 {shortTime(song.lastAiredAt)}</span>}
      </p>
      {blocked && <p className={styles.blockedNote}>不會再排進節目；按「封鎖」可解除。</p>}
      <div className={styles.toggles} role="group" aria-label={`${song.title} 的標記`}>
        {!blocked && <Toggle icon="heart" label="收藏" pressed={isLoved(song)} disabled={disabled} onClick={() => onAction('love', !isLoved(song))} />}
        {!blocked && (
          <Toggle
            icon="pin"
            label="釘選"
            pressed={pinned}
            disabled={disabled}
            describedBy={pinFull && !pinned ? 'pin-status' : undefined}
            onClick={() => onAction('pin', !pinned)}
          />
        )}
        {!blocked && (
          <button type="button" className={styles.toggle} aria-label="當種子開台" disabled={disabled} onClick={onSeed}>
            當種子
            <Icon name="arrow" size={18} />
          </button>
        )}
        <Toggle icon="block" label="封鎖" pressed={blocked} disabled={disabled} onClick={() => onAction('block', !blocked)} />
      </div>
      <div className={styles.rowFoot}>
        <button type="button" className={styles.disclosure} aria-expanded={expanded} aria-controls={`${id}-history`} onClick={() => setExpanded(!expanded)}>
          曲目資訊與帳本紀錄
          <Icon name="chevron" size={16} />
        </button>

      </div>
      {expanded && <div id={`${id}-history`} className={styles.details}>
        <p data-song-data>{title}</p>
        <p data-song-data>{artist}</p>
        {metadata?.canonicalAlbum && <p data-song-data>專輯：{metadata.canonicalAlbum}</p>}
        {metadata?.externalUrl && <a className={styles.spotifyLink} href={metadata.externalUrl} target="_blank" rel="noopener noreferrer">在 Spotify 開啟</a>}
        <History id={`${id}-entries`} history={history} onRetry={onLoadHistory} />
      </div>}
    </li>
  );
}
