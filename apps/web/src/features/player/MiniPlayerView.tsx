/**
 * Mini-player view (pure). The button always does what it shows (BRA-117): pause while audible,
 * play when the engine can really start/resume, otherwise「回收聽」— never a greyed-out play.
 */
import { isAudible } from '../../audio/engine';
import { currentItem } from '../../audio/queue';
import type { EngineState } from '../../audio/types';
import { IconButton } from '../../ui/Button';
import { phaseLabel } from './phase';
import styles from './sheets.module.css';

export type MiniAction = 'pause' | 'play' | 'open';

/** 引擎的 PLAY 在這些狀態下一定會開始／繼續（ready、paused、awaiting_gesture、completed）。 */
const PLAYABLE = new Set<EngineState['phase']>(['ready', 'paused', 'awaiting_gesture', 'completed']);

export function miniAction(state: EngineState): MiniAction {
  if (isAudible(state)) return 'pause';
  return PLAYABLE.has(state.phase) ? 'play' : 'open';
}

export function miniStatus(state: EngineState): string {
  if (state.phase === 'feedback') return '聽完了・回收聽留下回饋';
  if (state.phase === 'recoverable_error') return '播放中斷，回收聽頁處理';
  if (state.phase === 'speaking') {
    return currentItem(state)?.segment.speech.kind === 'ai_audio' ? 'DJ 介紹中 · AI 合成語音' : 'DJ 介紹中';
  }
  return phaseLabel(state);
}

const BUTTON: Record<MiniAction, { icon: 'pause' | 'play' | 'listen'; label: string }> = {
  pause: { icon: 'pause', label: '暫停' },
  play: { icon: 'play', label: '播放' },
  open: { icon: 'listen', label: '回收聽' },
};

interface MiniPlayerViewProps {
  state: EngineState;
  onOpen: () => void;
  onPlay: () => void;
  onPause: () => void;
}

export function MiniPlayerView({ state, onOpen, onPlay, onPause }: MiniPlayerViewProps) {
  const item = currentItem(state);
  if (!item) return null;
  const action = miniAction(state);
  const status = miniStatus(state);
  const title = item.segment.candidate.title;
  const button = BUTTON[action];
  const run = action === 'pause' ? onPause : action === 'play' ? onPlay : onOpen;
  return (
    <div className={styles.mini} data-testid="mini-player" data-action={action}>
      <span className={isAudible(state) ? `${styles.miniDisc} ${styles.miniDiscSpin}` : styles.miniDisc} aria-hidden="true" />
      <button type="button" className={styles.miniOpen} onClick={onOpen} aria-label={`返回收聽：${title}，${status}`}>
        <strong>{title}</strong>
        <span>{status}</span>
      </button>
      <IconButton icon={button.icon} label={button.label} tone="inverse" onClick={run} data-testid="mini-toggle" />
    </div>
  );
}
