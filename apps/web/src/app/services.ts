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
import { JourneyTracker } from '../features/journey/journeyTracker';
import { GemWallModel } from '../features/gems/gemWallModel';
import { GemSettleController } from '../features/gems/settleController';
import { useAppStore } from './appStore';

export const api = createApiClient();
export const feedbackForms = new FeedbackFormStore();
/** 「愛」→ Qualia Loved 確認流程（每次回饋最多一個）。 */
export const loveFlows = new LoveFlowStore();
/** 「我的歌」：品味帳本的清單與單曲動作（BRA-135）。 */
export const mySongs = new MySongsModel(api);
/** 寶石＋旅程膠囊（BRA-128）：只在記憶體；滿 5 顆時以朗讀區告知，不跳出大卡片。 */
export const journey = new JourneyTracker(() => useAppStore.getState().announce('這趟 5/5，旅程膠囊開好了'));
/** 寶石牆（BRA-169）：伺服器本機檔，跨 session 保存。 */
export const gemWall = new GemWallModel(api);
/** 五首結算翻牌：節目播完開牌堆，選完把伺服器回傳的新牆交給寶石牆。 */
export const gemSettle = new GemSettleController(api, (result) => {
  gemWall.apply(result.wall);
  useAppStore.getState().announce(result.unlocked ? `第 ${result.unlocked.no} 本旅程精選集，開出來了` : `「${result.gem.title}」成為你的第 ${result.wall.total} 顆寶石`);
});

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
  const created = engine;
  created.subscribe(() => {
    const state = created.getState();
    journey.observe(state);
    gemSettle.observe(state);
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
