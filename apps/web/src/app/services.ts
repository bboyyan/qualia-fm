/** App-wide singletons: exactly one API client, one generation per purpose (and, from T04, one playback engine). */
import { createApiClient, newIdempotencyKey } from '../api/client';
import { GenerationController, type GenerationDeps } from '../features/seed/generationController';
import { useAppStore } from './appStore';

export const api = createApiClient();

const deps: GenerationDeps = {
  api,
  timers: {
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  },
  isHidden: () => document.visibilityState === 'hidden',
  newKey: newIdempotencyKey,
  scenario: () => useAppStore.getState().mockScenario,
};

/** 開台 generation (S02/S03). */
export const generation = new GenerationController(deps);
/** 微調 generation: builds a replacement tail while the current track keeps playing (S07). */
export const tuneGeneration = new GenerationController(deps);

document.addEventListener('visibilitychange', () => {
  generation.onVisibilityChange();
  tuneGeneration.onVisibilityChange();
});
