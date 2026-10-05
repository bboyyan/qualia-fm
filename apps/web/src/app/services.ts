/** App-wide singletons: exactly one API client, one generation per purpose and exactly one playback engine. */
import { developerMode, canPresentShow } from './developerMode';
import { createApiClient, localError, newIdempotencyKey } from '../api/client';
import { createAdapter } from '../audio/adapters/createAdapter';
import { HtmlAudioAdapter } from '../audio/adapters/htmlAudioAdapter';
import { PlaybackRouter } from '../audio/adapters/playbackRouter';
import { PlaybackEngine } from '../audio/engine';
import { GenerationController, type GenerationDeps } from '../features/seed/generationController';
import { FeedbackFormStore } from '../features/player/feedbackForm';
import { LoveFlowStore } from '../features/player/loveFlow';
import { MySongsModel } from '../features/songs/mySongsModel';
import { useAppStore } from './appStore';

export const api = createApiClient();
export const feedbackForms = new FeedbackFormStore();
/** 「愛」→ Qualia Loved 確認流程（每次回饋最多一個）。 */
export const loveFlows = new LoveFlowStore();
/** 「我的歌」：品味帳本的清單與單曲動作（BRA-135）。 */
export const mySongs = new MySongsModel(api);

const deps: GenerationDeps = {
  api: {
    ...api,
    getShow: async (id) => {
      const show = await api.getShow(id);
      if (!canPresentShow(show, useAppStore.getState().capabilities?.providers?.llm, developerMode())) throw localError('INTERNAL');
      return show;
    },
  },
  timers: {
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  },
  isHidden: () => document.visibilityState === 'hidden',
  newKey: newIdempotencyKey,
  scenario: () => developerMode() ? useAppStore.getState().mockScenario : undefined,
};

/** 開台 generation (S02/S03). */
export const generation = new GenerationController(deps);
/** 微調 generation: builds a replacement tail while the current track keeps playing (S07). */
export const tuneGeneration = new GenerationController(deps);

document.addEventListener('visibilitychange', () => {
  generation.onVisibilityChange();
  tuneGeneration.onVisibilityChange();
});

let router: PlaybackRouter | null = null;
let engine: PlaybackEngine | null = null;

/**
 * The single PlaybackEngine, created on first use from the server capability report (mock in
 * this build). Pages never construct audio themselves (AGENTS.md rule 6).
 */
export function getEngine(): PlaybackEngine {
  if (engine) return engine;
  const store = useAppStore.getState();
  const caps = store.capabilities ?? { mode: 'mock' as const, spotifyEnabled: false, canSeek: true };
  // 沒有 Spotify 輸出時，router 把一切原樣交給單一 <audio>（與以前相同）。
  router = new PlaybackRouter(createAdapter(caps));
  engine = new PlaybackEngine(router, {
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
  return router?.base instanceof HtmlAudioAdapter ? router.base : undefined;
}

/** E 模式接上／拔掉 Spotify 輸出用。 */
export function getRouter(): PlaybackRouter {
  getEngine();
  if (!router) throw new Error('playback router not initialised');
  return router;
}
