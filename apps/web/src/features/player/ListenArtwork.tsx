/**
 * 收聽頁的曲目視覺：Spotify 對應到的曲目顯示封面＋正式 metadata＋Spotify 標示與外連（Policy II.4／II.5），
 * 其他顯示 Qualia 自己的聲景圖。回饋時也保留，讓人知道是在回饋哪一首（BRA-117）。
 */
import type { Segment } from '@qualia/contracts';
import type { EngineState } from '../../audio/types';
import { SoundscapeArt } from '../../ui/SoundscapeArt';
import { SpotifyTrackCard } from '../spotify/SpotifyTrackCard';

export function ListenArtwork({ state, segment }: { state: EngineState; segment: Segment }) {
  const { track } = segment;
  const playing = state.phase === 'track_playing';
  if (track.provider === 'spotify' && track.availability === 'resolved') {
    return <SpotifyTrackCard track={track} confirmed={state.playbackMode === 'spotify' && playing} />;
  }
  const palette = track.audioLocator.kind === 'mock_tone' ? track.audioLocator.palette : state.currentIndex;
  return <SoundscapeArt palette={palette} spinning={playing} compact={state.phase === 'feedback'} kicker="THE TEXTURE OF TONIGHT" />;
}
