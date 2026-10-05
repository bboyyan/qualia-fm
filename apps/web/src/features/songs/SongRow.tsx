/**
 * 「我的歌」的一列：曲名／藝人、最近評價，三個狀態鈕（收藏／釘選／封鎖）、當種子開台，
 * 以及可展開的最近幾筆帳本紀錄。封鎖的歌只留「封鎖」鈕（再按一次解除）與紀錄。
 */
import { useEffect, useId, useState } from 'react';
import type { TrackMark } from '@qualia/contracts';
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
  /** 釘選名額已滿（這首未釘選時按下只會提示）。 */
  pinFull: boolean;
  busy: boolean;
  disabled: boolean;
  history: HistoryState | undefined;
  onAction: (action: SongAction, on: boolean) => void;
  onSeed: () => void;
  onLoadHistory: () => void;
}

export function SongRow({ song, pinFull, busy, disabled, history, onAction, onSeed, onLoadHistory }: SongRowProps) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const blocked = isBlocked(song);
  const pinned = isPinned(song);
  const rating = ratingSummary(song);
  // 展開中且紀錄被動作清掉（或第一次展開）時讀取。
  useEffect(() => {
    if (expanded && !history) onLoadHistory();
  }, [expanded, history, onLoadHistory]);

  return (
    <li className={styles.row} data-state={blocked ? 'blocked' : pinned ? 'pinned' : undefined} data-testid="song-row" aria-busy={busy || undefined}>
      <div className={styles.rowHead}>
        <div className={styles.rowText}>
          <h3 className={styles.title} data-song-data>
            {song.title}
          </h3>
          <p className={styles.artist} data-song-data>
            {song.artist}
          </p>
        </div>
        {pinned && <span className={styles.tag}>釘選</span>}
        {blocked && <span className={`${styles.tag} ${styles.tagBlocked}`}>已封鎖</span>}
      </div>
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
        <Toggle icon="block" label="封鎖" pressed={blocked} disabled={disabled} onClick={() => onAction('block', !blocked)} />
      </div>
      <div className={styles.rowFoot}>
        <button type="button" className={styles.disclosure} aria-expanded={expanded} aria-controls={`${id}-history`} onClick={() => setExpanded(!expanded)}>
          帳本紀錄
          <Icon name="chevron" size={16} />
        </button>
        {!blocked && (
          <button type="button" className={styles.seed} disabled={disabled} onClick={onSeed}>
            當種子開台
            <Icon name="arrow" size={18} />
          </button>
        )}
      </div>
      {expanded && <History id={`${id}-history`} history={history} onRetry={onLoadHistory} />}
    </li>
  );
}
