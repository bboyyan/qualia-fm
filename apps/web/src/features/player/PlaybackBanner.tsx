/**
 * S09 blocking states in the page flow: autoplay blocked → one clear tap; device lost →
 * reconnect; repeated source failures → retry. Segment and position are preserved.
 */
import { getEngine, mockAudioControls } from '../../app/services';
import type { EngineState } from '../../audio/types';
import { Button } from '../../ui/Button';
import { InlineRecovery } from '../../ui/Feedback';
import { SpotifyRecovery } from '../spotify/SpotifyPanels';

export function PlaybackBanner({ state }: { state: EngineState }) {
  const engine = getEngine();
  const spotify = state.playbackMode === 'spotify';
  if (state.phase === 'awaiting_gesture' && spotify && state.error?.code === 'AUDIO_SOURCE_FAILED') {
    return (
      <InlineRecovery
        tone="warning"
        title="Spotify 還沒開始播這首"
        testId="autoplay-blocked"
        actions={
          <Button block onClick={() => engine.play()} data-testid="tap-to-resume">
            點一下繼續
          </Button>
        }
      >
        介紹已經念完。點一下再請 Spotify 播一次；不會重念介紹，也不會自己跳到下一首。
      </InlineRecovery>
    );
  }
  if (state.phase === 'awaiting_gesture' && spotify) {
    return (
      <InlineRecovery
        tone="warning"
        title="暫停在這裡，等你"
        testId="autoplay-blocked"
        actions={
          <Button block onClick={() => engine.play()} data-testid="tap-to-resume">
            點一下繼續
          </Button>
        }
      >
        <p>iPhone 需要你親手點一下，才能開始下一段聲音。介紹和歌都在原地等你。</p>
        <p>這是瀏覽器的保護機制，不是壞掉。剛才可能鎖屏或切到別的 App。</p>
      </InlineRecovery>
    );
  }
  if (state.phase === 'awaiting_gesture') {
    return (
      <InlineRecovery
        tone="warning"
        title="點一下，繼續這段節目"
        testId="autoplay-blocked"
        actions={
          <Button block onClick={() => engine.play()} data-testid="tap-to-resume">
            點一下繼續
          </Button>
        }
      >
        手機瀏覽器需要你再按一次，才能播放聲音。目前的曲目與進度都已保留。
      </InlineRecovery>
    );
  }
  if (state.phase === 'reconciling') {
    return <InlineRecovery tone="info" title="正在確認播放狀態…" testId="reconciling" />;
  }
  if (state.phase !== 'recoverable_error' || !state.error) return null;
  if (spotify && state.error.code === 'DEVICE_UNAVAILABLE') return <SpotifyRecovery state={state} />;
  const deviceLost = state.error.code === 'DEVICE_UNAVAILABLE';
  return (
    <InlineRecovery
      tone={deviceLost ? 'offline' : 'error'}
      title={deviceLost ? '播放裝置目前未連線' : '這首暫時無法播放'}
      testId="playback-error"
      actions={
        <Button
          variant="outline"
          block
          onClick={() => {
            mockAudioControls()?.reconnect();
            engine.play();
          }}
        >
          {deviceLost ? '重新連線' : '再試一次'}
        </Button>
      }
    >
      {deviceLost
        ? '音樂連線中斷，不是你按了暫停。節目單與最後確認的進度都還在。'
        : spotify
          ? 'Spotify 試了兩次仍沒開始播這首，所以先停在這裡，不會無限重試。可以再試一次，或按下一首。'
          : '已自動略過無法播放的曲目，仍失敗所以先停下來，不會無限重試。'}
    </InlineRecovery>
  );
}
