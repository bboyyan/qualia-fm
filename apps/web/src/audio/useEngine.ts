import { useEffect, useSyncExternalStore } from 'react';
import { getEngine } from '../app/services';
import type { EngineState } from './types';

export function useEngineState(): EngineState {
  const engine = getEngine();
  return useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
}

const POSITION_TICK_MS = 250;

/**
 * Provider-confirmed position, re-read every 250ms only while audible and the page is visible
 * (no per-frame re-render, no hidden-tab timers). Otherwise the last confirmed value is shown.
 */
export function usePlaybackPosition(active: boolean): number {
  const engine = getEngine();
  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
  useEffect(() => {
    if (!active) return;
    engine.positionMs();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') engine.positionMs();
    }, POSITION_TICK_MS);
    return () => window.clearInterval(timer);
  }, [active, engine]);
  return state.positionMs;
}
