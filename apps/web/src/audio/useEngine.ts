import { useEffect, useSyncExternalStore } from 'react';
import { getEngine } from '../app/services';
import type { EngineState } from './types';

export function useEngineState(): EngineState {
  const engine = getEngine();
  return useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
}

/**
 * Provider-confirmed position. The engine's own 250ms timer persists it while audible, so this
 * hook only subscribes (no second interval, no extra re-renders); it reads once when the view
 * becomes active so returning to the player never shows a value up to one tick stale.
 */
export function usePlaybackPosition(active: boolean): number {
  const engine = getEngine();
  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
  useEffect(() => {
    if (active) engine.positionMs();
  }, [active, engine]);
  return state.positionMs;
}
