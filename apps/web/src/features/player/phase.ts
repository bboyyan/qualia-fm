/** 播放狀態的顯示文字與判斷（純函式，收聽頁與迷你播放器共用）。 */
import type { EngineState, Phase } from '../../audio/types';

const PHASE_LABEL: Record<Phase, string> = {
  manual_ready: '請在 Spotify app 自己點歌',
  manual_playing: '外部播放中（由你確認）',
  feedback: '聽完了，留下回饋或略過',
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

/** E 模式時曲目只有在 Spotify 狀態確認真的在播後才會進 track_playing。 */
export function phaseLabel(state: EngineState): string {
  if (state.playbackMode === 'spotify' && state.phase === 'track_playing') return 'Spotify 播放中・已確認有聲音';
  if (state.playbackMode === 'spotify' && state.phase === 'loading_track') return '介紹已停，正在請 Spotify 開始…';
  return PHASE_LABEL[state.phase];
}

export function isSpeechPhase(state: EngineState): boolean {
  return (
    state.phase === 'speaking' ||
    state.phase === 'loading_speech' ||
    (state.phase === 'paused' && state.resumePhase === 'speech') ||
    (state.phase === 'awaiting_gesture' && state.pendingOwner === 'speech')
  );
}
