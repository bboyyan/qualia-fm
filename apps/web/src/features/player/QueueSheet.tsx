/**
 * S06 節目單: order, title, short bridge and status for each segment. The playing row cannot be
 * removed; removing an upcoming row offers a 5-second undo; tapping a row never switches songs —
 * only the explicit "現在播放" does.
 */
import { useAppStore } from '../../app/appStore';
import { SheetToast } from '../../app/AppShell';
import { getEngine } from '../../app/services';
import { bridgeAt } from '../../audio/queue';
import type { EngineState, QueueItem, SegmentStatus } from '../../audio/types';
import { useEngineState } from '../../audio/useEngine';
import { BottomSheet } from '../../ui/BottomSheet';
import styles from './sheets.module.css';

const STATUS_LABEL: Record<SegmentStatus, string> = {
  queued: '待播',
  playing: '正在播放',
  played: '已播',
  skipped: '已略過',
  failed: '無法播放',
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

function statusOf(state: EngineState, item: QueueItem, index: number): SegmentStatus {
  if (index === state.currentIndex && state.phase !== 'ready' && state.phase !== 'completed' && state.phase !== 'feedback') return 'playing';
  return state.statuses[item.segment.segmentId] === 'playing' ? 'queued' : (state.statuses[item.segment.segmentId] ?? 'queued');
}

function QueueRow({ state, item, index }: { state: EngineState; item: QueueItem; index: number }) {
  const closeSheet = useAppStore((s) => s.closeSheet);
  const showToast = useAppStore((s) => s.showToast);
  const engine = getEngine();
  const status = statusOf(state, item, index);
  const isCurrent = index === state.currentIndex;
  const upcoming = index > state.currentIndex;
  const title = item.segment.candidate.title;
  const remove = () => {
    const result = engine.removeUpcoming(item.segment.segmentId);
    if (result.rejected) return;
    const revision = result.state.queueRevision;
    showToast(`已從接下來移除「${title}」。`, { label: '復原', run: () => engine.restoreRemoved(revision) });
  };
  return (
    <li className={isCurrent ? `${styles.row} ${styles.rowCurrent}` : styles.row} data-testid="queue-row" data-status={status}>
      <span className={styles.rowIndex}>{pad2(index + 1)}</span>
      <div className={styles.rowData}>
        <h3>{title}</h3>
        <p>{bridgeAt(state, index)?.text}</p>
      </div>
      <div className={styles.rowActions}>
        <span className={styles.status}>{STATUS_LABEL[status]}</span>
        {!isCurrent && (
          <button
            type="button"
            className={styles.rowButton}
            onClick={() => {
              engine.jump(item.segment.segmentId);
              closeSheet();
            }}
            disabled={state.phase === 'feedback'}
            aria-label={`現在播放 ${title}`}
          >
            現在播放
          </button>
        )}
        {upcoming && (
          <button type="button" className={`${styles.rowButton} ${styles.rowRemove}`} onClick={remove} aria-label={`移除 ${title}`}>
            移除
          </button>
        )}
      </div>
    </li>
  );
}

export function QueueSheet() {
  const open = useAppStore((s) => s.sheet === 'queue');
  const closeSheet = useAppStore((s) => s.closeSheet);
  const state = useEngineState();
  const unavailable = state.show?.unavailable ?? [];
  return (
    <BottomSheet open={open && state.queue.length > 0} title={`這一段 · ${state.queue.length} 首`} onClose={() => closeSheet()} testId="queue-sheet">
      <SheetToast />
      <p className={styles.lead}>查看清單不會中斷播放。想跳到某首，請按「現在播放」。</p>
      <ol className={styles.rows} aria-label="節目單">
        {state.queue.map((item, index) => (
          <QueueRow key={item.segment.segmentId} state={state} item={item} index={index} />
        ))}
      </ol>
      {unavailable.length > 0 && (
        <>
          <h3 className={styles.subhead}>暫時無法使用（不會播放）</h3>
          <ul className={styles.unavailable}>
            {unavailable.map((c) => (
              <li key={c.candidateId}>{c.title} · 待確認</li>
            ))}
          </ul>
        </>
      )}
      <p className={styles.disclaimer}>移除只影響接下來的曲目，正在播放的這首不會被刪除。排序調整在後續階段提供。</p>
    </BottomSheet>
  );
}
