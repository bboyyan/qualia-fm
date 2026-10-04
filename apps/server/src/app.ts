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
import { RealProviderRuntime } from './budget/runtime.js';
import { OpenAIEditorialPlanner } from './providers/openai/planner.js';
import { OpenAITtsProvider } from './providers/openai/tts.js';
import { logger } from './http/log.js';
import { JobStore } from './stores/jobStore.js';

export interface AppOverrides {
  fetchImpl?: typeof fetch;
  ledger?: FeedbackLedger;
  store?: JobStore;
  now?: () => number;
  clock?: PhaseClock;
  planner?: EditorialPlanner;
  resolver?: CatalogResolver;
}

export interface QualiaApp {
  app: Express;
  plans: PlanService;
  sessions: SessionStore;
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

export function createApp(config: ServerConfig, overrides: AppOverrides = {}): QualiaApp {
  const now = overrides.now ?? Date.now;
  const sessions = new SessionStore();
  const runtime = new RealProviderRuntime(config.openai, now);
  const startupReason = runtime.reason();
  if (startupReason) logger.error('openai_disabled', { reason: startupReason });
  const mockPlanner = new MockEditorialPlanner();
  const realLlm = config.openai.llm === 'openai';
  // 失敗／拒答／兩次無效時由 PlanService 改用 fallbackPlanner（MOCK）並把提示放在 warnings 最前面。
  const planner: EditorialPlanner = realLlm ? new OpenAIEditorialPlanner(config.openai, runtime, overrides.fetchImpl ?? fetch) : mockPlanner;
  const tts = new OpenAITtsProvider(config.openai, runtime, overrides.fetchImpl ?? fetch, now);
  const plans = new PlanService({
    config,
    ledger: overrides.ledger ?? new InMemoryLedger(),
    planner: overrides.planner ?? planner,
    fallbackPlanner: realLlm ? mockPlanner : undefined,
    runtime: config.openai.llm === 'openai' || config.openai.tts === 'openai' ? runtime : undefined,
    tts: config.openai.tts === 'openai' ? tts : undefined,
    resolver: overrides.resolver ?? new MockCatalogResolver(config.mock.trackMs),
    store: overrides.store ?? new JobStore(now),
    clock: overrides.clock ?? realClock,
    now,
  });
  const app = express();
  app.disable('x-powered-by');
  app.use(requestIdMiddleware, accessLog, securityHeaders);
  app.use('/api', express.json({ limit: '16kb' }), createApiRouter({ config, sessions, plans, now, runtime, tts }));
  if (config.staticDir && existsSync(join(config.staticDir, 'index.html'))) serveStatic(app, config.staticDir);
  app.use(errorHandler);
  return { app, plans, sessions };
}
