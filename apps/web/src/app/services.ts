/** App-wide singletons: exactly one API client, one generation per purpose and exactly one playback engine. */
import { createApiClient, newIdempotencyKey } from '../api/client';
import { createAdapter } from '../audio/adapters/createAdapter';
import { HtmlAudioAdapter } from '../audio/adapters/htmlAudioAdapter';
import { PlaybackEngine } from '../audio/engine';
import type { MediaAdapter } from '../audio/types';
import { GenerationController, type GenerationDeps } from '../features/seed/generationController';
import { FeedbackFormStore } from '../features/player/feedbackForm';
import { useAppStore } from './appStore';

export const api = createApiClient();
export const feedbackForms = new FeedbackFormStore();

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

let adapter: MediaAdapter | null = null;
let engine: PlaybackEngine | null = null;

/**
 * The single PlaybackEngine, created on first use from the server capability report (mock in
 * this build). Pages never construct audio themselves (AGENTS.md rule 6).
 */
export function getEngine(): PlaybackEngine {
  if (engine) return engine;
  const store = useAppStore.getState();
  const caps = store.capabilities ?? { mode: 'mock' as const, spotifyEnabled: false, canSeek: true };
  adapter = createAdapter(caps);
  engine = new PlaybackEngine(adapter, {
    playbackMode: store.settings.playbackMode,
    feedbackEnabled: true,
    djEnabled: store.settings.djEnabled,
    canSeek: caps.canSeek,
    onAnnounce: (message) => useAppStore.getState().announce(message),
  });
  return engine;
}

/** MOCK-only review hooks (Settings → 情境預覽); undefined for any non-mock adapter. */
export function mockAudioControls(): Pick<HtmlAudioAdapter, 'simulateAutoplayBlockOnce' | 'simulateDeviceLost' | 'reconnect'> | undefined {
  getEngine();
  return adapter instanceof HtmlAudioAdapter ? adapter : undefined;
}
