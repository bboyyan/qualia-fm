import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express } from 'express';
import type { ServerConfig } from './config/env.js';
import { errorHandler, requestIdMiddleware } from './http/errors.js';
import { accessLog } from './http/log.js';
import { MockCatalogResolver } from './providers/mockCatalog.js';
import { MockEditorialPlanner } from './providers/mockPlanner.js';
import type { CatalogResolver, EditorialPlanner, PhaseClock } from './providers/types.js';
import { createApiRouter } from './routes/api.js';
import { securityHeaders } from './security/headers.js';
import { SessionStore } from './security/sessions.js';
import { PlanService, realClock } from './services/planService.js';
import { InMemoryLedger } from './ledger/fake.js';
import type { FeedbackLedger } from './ledger/types.js';
import { TasteLedger, filePersistence, memoryPersistence } from './ledger/tasteStore.js';
import { ShowHistory } from './ledger/showHistory.js';
import { SongDisplayService } from './services/songDisplayService.js';
import { TasteService } from './services/tasteService.js';
import { GemWallStore } from './gems/gemWallStore.js';
import { RealProviderRuntime } from './budget/runtime.js';
import { OpenAIEditorialPlanner } from './providers/openai/planner.js';
import { OpenAITtsProvider } from './providers/openai/tts.js';
import { logger } from './http/log.js';
import { JobStore } from './stores/jobStore.js';
import { spotifyCallback, type SpotifyServices } from './routes/spotify.js';
import { SpotifyAuth } from './spotify/auth.js';
import { LovedPlaylist } from './spotify/loved.js';
import { SpotifyCatalogResolver } from './spotify/resolver.js';
import { SpotifyTokenStore } from './spotify/tokenStore.js';
import { SpotifyWebApi } from './spotify/webApi.js';

export interface AppOverrides {
  fetchImpl?: typeof fetch;
  ledger?: FeedbackLedger;
  /** 品味帳本（預設依 TASTE_LEDGER_PATH 建立本機檔）。 */
  tasteLedger?: TasteLedger;
  showHistory?: ShowHistory;
  /** 寶石牆（預設依 GEM_WALL_PATH 建立本機檔）。 */
  gemWall?: GemWallStore;
  store?: JobStore;
  now?: () => number;
  clock?: PhaseClock;
  planner?: EditorialPlanner;
  resolver?: CatalogResolver;
  /** 候選池抽樣亂數（BRA-127）。 */
  random?: () => number;
}

export interface QualiaApp {
  app: Express;
  plans: PlanService;
  sessions: SessionStore;
  /** 只在 SPOTIFY_ENABLED=true 時存在；關閉時不建立任何 Spotify 物件、不讀 token 檔。 */
  spotify: SpotifyServices | undefined;
}

function serveStatic(app: Express, dir: string): void {
  const index = join(dir, 'index.html');
  app.use(express.static(dir, { index: false, maxAge: '1h', setHeaders: (res, path) => {
    if (path.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json');
    if (path.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
  } }));
  app.get('/{*path}', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}

/** 只在 SPOTIFY_ENABLED=true 時建立；預設不建立任何 Spotify 物件、不讀 token 檔。 */
function createSpotify(config: ServerConfig, fetchImpl: typeof fetch, now: () => number): SpotifyServices | undefined {
  if (!config.gates.spotifyEnabled) return undefined;
  const auth = new SpotifyAuth(config.spotify, new SpotifyTokenStore(config.spotify.tokenFile, config.spotify.tokenKey, now), fetchImpl, now);
  const api = new SpotifyWebApi(auth, fetchImpl);
  return { auth, api, loved: new LovedPlaylist(api, config.spotify.lovedPlaylistId) };
}

function createTasteLedger(config: ServerConfig): TasteLedger {
  if (config.tasteLedger.path) return new TasteLedger(filePersistence(config.tasteLedger.path));
  logger.info('taste_ledger_memory_only', { reason: 'TASTE_LEDGER_PATH unset in test' });
  return new TasteLedger(memoryPersistence());
}

function createGemWall(config: ServerConfig, now: () => number): GemWallStore {
  if (config.gemWall.path) return new GemWallStore(filePersistence(config.gemWall.path), now);
  logger.info('gem_wall_memory_only', { reason: 'GEM_WALL_PATH unset in test' });
  return new GemWallStore(memoryPersistence(), now);
}

export function createApp(config: ServerConfig, overrides: AppOverrides = {}): QualiaApp {
  const now = overrides.now ?? Date.now;
  const sessions = new SessionStore(config.sessions.path ? filePersistence(config.sessions.path) : undefined, now);
  const runtime = new RealProviderRuntime(config.openai, now);
  const startupReason = runtime.reason();
  if (startupReason) logger.error('openai_disabled', { reason: startupReason });
  const mockPlanner = new MockEditorialPlanner();
  const realLlm = config.openai.llm === 'openai';
  // 失敗／拒答／兩次無效時由 PlanService 改用 fallbackPlanner（MOCK）並把提示放在 warnings 最前面。
  const planner: EditorialPlanner = realLlm ? new OpenAIEditorialPlanner(config.openai, runtime, overrides.fetchImpl ?? fetch) : mockPlanner;
  const tts = new OpenAITtsProvider(config.openai, runtime, overrides.fetchImpl ?? fetch, now);
  const spotify = createSpotify(config, overrides.fetchImpl ?? fetch, now);
  const tasteService = new TasteService(overrides.tasteLedger ?? createTasteLedger(config), now);
  const showHistory = overrides.showHistory ?? new ShowHistory(config.showHistory.path ? filePersistence(config.showHistory.path) : memoryPersistence());
  const store = overrides.store ?? new JobStore(now);
  const songDisplay = new SongDisplayService(tasteService, store, spotify ? new SpotifyCatalogResolver(spotify.api) : undefined, now);
  const plans = new PlanService({
    showHistory,
    config,
    sessions,
    ledger: overrides.ledger ?? new InMemoryLedger(),
    tasteService,
    planner: overrides.planner ?? planner,
    fallbackPlanner: realLlm ? mockPlanner : undefined,
    runtime: config.openai.llm === 'openai' || config.openai.tts === 'openai' ? runtime : undefined,
    tts: config.openai.tts === 'openai' ? tts : undefined,
    resolver: overrides.resolver ?? new MockCatalogResolver(config.mock.trackMs),
    spotify: spotify ? { resolver: new SpotifyCatalogResolver(spotify.api), linked: () => spotify.auth.isLinked() } : undefined,
    store,
    clock: overrides.clock ?? realClock,
    now,
    random: overrides.random,
  });
  const app = express();
  app.disable('x-powered-by');
  app.use(requestIdMiddleware, accessLog, securityHeaders(config.gates.spotifyEnabled));
  const gems = overrides.gemWall ?? createGemWall(config, now);
  const apiDeps = { songDisplay, config, sessions, plans, tasteService, showHistory, gems, now, runtime, tts, spotify };
  app.use('/api', express.json({ limit: '16kb' }), createApiRouter(apiDeps));
  // Spotify 後台登記的 redirect URI 是 /callback：必須在 SPA fallback 之前處理。
  if (spotify) app.get('/callback', spotifyCallback(apiDeps));
  if (config.staticDir && existsSync(join(config.staticDir, 'index.html'))) serveStatic(app, config.staticDir);
  app.use(errorHandler);
  return { app, plans, sessions, spotify };
}
