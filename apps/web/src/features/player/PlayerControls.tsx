/**
 * Phase-aware transport (docs/02 S04, docs/03 TransportControls/SeekBar): restart-this-track,
 * 64px play/pause, next. Progress comes from the provider; seeking is a single commit on release
 * and only when the adapter can seek during the track phase.
 */
import { useId, useState } from 'react';
import { getEngine } from '../../app/services';
import { isAudible } from '../../audio/engine';
import { currentBridge, currentItem, nextItem } from '../../audio/queue';
import type { EngineState, Phase } from '../../audio/types';
import { usePlaybackPosition } from '../../audio/useEngine';
import { Button, IconButton } from '../../ui/Button';
import styles from './player.module.css';

export const formatTime = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const PHASE_LABEL: Record<Phase, string> = {
  manual_ready: '請在 Spotify app 自己點歌',
  manual_playing: '外部播放中（由你確認）',
  feedback: '等待回饋',
  empty: '尚無節目',
  ready: '尚未開始播放',
  loading_speech: '準備介紹…',
  speaking: 'DJ 介紹中',
  loading_track: '準備曲目…',
  track_playing: 'MOCK 合成測試音播放中',
  paused: '已暫停',
  awaiting_gesture: '需要點一下才能繼續',
  reconciling: '正在確認播放狀態',
  recoverable_error: '播放中斷',
  completed: '這一段已結束',
};

export function isSpeechPhase(state: EngineState): boolean {
  return (
    state.phase === 'speaking' ||
    state.phase === 'loading_speech' ||
    (state.phase === 'paused' && state.resumePhase === 'speech') ||
    (state.phase === 'awaiting_gesture' && state.pendingOwner === 'speech')
  );
}

export function DjStrip({ state }: { state: EngineState }) {
  const bridge = currentBridge(state);
  if (!isSpeechPhase(state) || !bridge) return null;
  return (
    <section className={styles.djStrip} aria-label="DJ 介紹" data-testid="dj-strip">
      <div className={styles.djHead}>
        <p>
          {state.phase === 'paused' ? '介紹已暫停' : 'DJ 正在介紹'}
          <span> · MOCK 提示音，非 AI 語音</span>
        </p>
        <Button variant="text" trailingIcon="chevron" onClick={() => getEngine().skipIntro()} data-testid="skip-intro">
          跳過介紹
        </Button>
      </div>
      <p className={styles.djLine}>「{bridge.djLine}」</p>
    </section>
  );
}

export function SeekBar({ state }: { state: EngineState }) {
  const id = useId();
  const engine = getEngine();
  const item = currentItem(state);
  const speech = isSpeechPhase(state);
  const position = usePlaybackPosition(state.phase === 'speaking' || state.phase === 'track_playing');
  const [drag, setDrag] = useState<number | null>(null);
  if (!item) return null;
  const durationMs = speech && item.segment.speech.kind === 'mock_chime' ? item.segment.speech.durationMs : (item.segment.track.durationMs ?? 0);
  const seekable = state.canSeek && (state.phase === 'track_playing' || (state.phase === 'paused' && state.resumePhase === 'track'));
  const atRest = state.phase === 'ready' || state.phase === 'completed';
  const shown = Math.min(durationMs, drag ?? (atRest ? 0 : position));
  const commit = () => {
    if (drag === null) return;
    engine.seek(drag);
    setDrag(null);
  };
  return (
    <div className={styles.progress}>
      <div className={styles.progressLabel}>
        <span data-testid="phase-label">{speech ? '介紹片段' : '曲目進度'} · {PHASE_LABEL[state.phase]}</span>
      </div>
      <label className="sr-only" htmlFor={id}>
        {speech ? '介紹進度（不可拖動）' : '曲目進度'}
      </label>
      <input
        id={id}
        type="range"
        className={styles.range}
        min={0}
        max={Math.max(1, durationMs)}
        step={1000}
        value={shown}
        disabled={!seekable}
        aria-valuetext={`${formatTime(shown)} / ${formatTime(durationMs)}`}
        style={{ '--fill': `${durationMs > 0 ? (shown / durationMs) * 100 : 0}%` } as React.CSSProperties}
        onChange={(e) => seekable && setDrag(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        data-testid="seek"
      />
      <div className={styles.timeRow}>
        <span data-testid="elapsed">{formatTime(shown)}</span>
        <span>{formatTime(durationMs)} · {speech ? 'MOCK 提示音' : 'MOCK 合成音'}</span>
      </div>
    </div>
  );
}

export function Transport({ state }: { state: EngineState }) {
  const engine = getEngine();
  const audible = isAudible(state);
  const speech = isSpeechPhase(state);
  const hasNext = nextItem(state) !== null;
  const playLabel = audible ? (speech ? '暫停介紹' : '暫停') : state.phase === 'paused' ? '繼續播放' : '播放';
  return (
    <div className={styles.transport}>
      <IconButton
        icon="restart"
        label={speech ? '重播本曲（介紹中請用跳過介紹）' : '重播本曲，不重念介紹'}
        disabled={speech || state.phase === 'ready' || state.phase === 'completed'}
        onClick={() => engine.restartTrack()}
        data-testid="restart"
      />
      <IconButton icon={audible ? 'pause' : 'play'} label={playLabel} tone="primary" size="lg" onClick={() => engine.toggle()} data-testid="play-toggle" />
      <IconButton icon="next" label={hasNext ? '下一首' : '略過最後一首'} onClick={() => engine.next()} data-testid="next" />
    </div>
  );
}
