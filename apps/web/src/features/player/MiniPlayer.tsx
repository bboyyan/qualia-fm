/**
 * Mini-player above the bottom nav whenever a show is loaded and the user is not on 收聽.
 * It only dispatches engine commands; it never owns audio.
 */
import { useAppStore } from '../../app/appStore';
import { getEngine } from '../../app/services';
import type { EngineState } from '../../audio/types';
import { MiniPlayerView } from './MiniPlayerView';

export function MiniPlayer({ state }: { state: EngineState }) {
  const setTab = useAppStore((s) => s.setTab);
  return (
    <MiniPlayerView
      state={state}
      onOpen={() => setTab('listen')}
      onPlay={() => getEngine().play()}
      onPause={() => getEngine().pause()}
    />
  );
}
