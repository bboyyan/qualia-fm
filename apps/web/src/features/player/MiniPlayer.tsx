/**
 * Mini-player above the bottom nav whenever a show is loaded and the user is not on 收聽.
 * It only dispatches engine commands; it never owns audio.
 */
import { useAppStore } from '../../app/appStore';
import { getEngine } from '../../app/services';
import { isAudible } from '../../audio/engine';
import { currentItem } from '../../audio/queue';
import type { EngineState, Phase } from '../../audio/types';
import { IconButton } from '../../ui/Button';
import styles from './sheets.module.css';

const STATUS: Record<Phase, string> = {
  empty: '',
  ready: '尚未開始播放',
  loading_speech: '準備介紹…',
  speaking: 'DJ 介紹中 · MOCK 提示音',
  loading_track: '準備曲目…',
  track_playing: 'MOCK 合成音播放中',
  paused: '已暫停',
  awaiting_gesture: '需要點一下繼續',
  reconciling: '正在確認播放狀態',
  recoverable_error: '播放中斷，回收聽頁處理',
  completed: '這一段已結束',
};

export function MiniPlayer({ state }: { state: EngineState }) {
  const setTab = useAppStore((s) => s.setTab);
  const item = currentItem(state);
  if (!item) return null;
  const audible = isAudible(state);
  const title = item.segment.candidate.title;
  return (
    <div className={styles.mini} data-testid="mini-player">
      <span className={audible ? `${styles.miniDisc} ${styles.miniDiscSpin}` : styles.miniDisc} aria-hidden="true" />
      <button type="button" className={styles.miniOpen} onClick={() => setTab('listen')} aria-label={`返回收聽：${title}，${STATUS[state.phase]}`}>
        <strong>{title}</strong>
        <span>{STATUS[state.phase]}</span>
      </button>
      <IconButton
        icon={audible ? 'pause' : 'play'}
        label={audible ? '暫停' : '播放'}
        tone="inverse"
        disabled={state.phase === 'recoverable_error'}
        onClick={() => getEngine().toggle()}
        data-testid="mini-toggle"
      />
    </div>
  );
}
