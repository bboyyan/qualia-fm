/**
 * Phase-aware transport (docs/02 S04, docs/03 TransportControls/SeekBar): restart-this-track,
 * 64px play/pause, next. Progress comes from the provider; seeking is a single commit on release
 * and only when the adapter can seek during the track phase.
 */
import { useId, useState } from 'react';
import { getEngine } from '../../app/services';
import { isAudible } from '../../audio/engine';
import { currentBridge, currentItem, nextItem } from '../../audio/queue';
import type { EngineState } from '../../audio/types';
import { usePlaybackPosition } from '../../audio/useEngine';
import { DjIntroduction } from './DjIntroduction';
import { isSpeechPhase, phaseLabel } from './phase';
import { IconButton } from '../../ui/Button';
import styles from './player.module.css';

export const formatTime = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export function DjStrip({ state }: { state: EngineState }) {
  const bridge = currentBridge(state);
  if (!isSpeechPhase(state) || !bridge) return null;
  return <DjIntroduction djLine={bridge.djLine} paused={state.phase === 'paused'} aiVoice={currentItem(state)?.segment.speech.kind === 'ai_audio'} onSkip={() => getEngine().skipIntro()} />;
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
        <span data-testid="phase-label">{speech ? '介紹片段' : '曲目進度'} · {phaseLabel(state)}</span>
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
        <span>{formatTime(durationMs)} · {speech ? (item.segment.speech.kind === 'ai_audio' ? 'AI 合成語音' : '介紹') : item.segment.track.provider === 'spotify' ? 'Spotify' : '音訊'}</span>
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
