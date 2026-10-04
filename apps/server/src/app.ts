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
import { JobStore } from './stores/jobStore.js';

export interface AppOverrides {
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
  app.use(express.static(dir, { index: false, maxAge: '1h' }));
  app.get('/{*path}', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}

export function createApp(config: ServerConfig, overrides: AppOverrides = {}): QualiaApp {
  const now = overrides.now ?? Date.now;
  const sessions = new SessionStore();
  const plans = new PlanService({
    config,
    planner: overrides.planner ?? new MockEditorialPlanner(),
    resolver: overrides.resolver ?? new MockCatalogResolver(config.mock.trackMs),
    store: new JobStore(),
    clock: overrides.clock ?? realClock,
    now,
  });
  const app = express();
  app.disable('x-powered-by');
  app.use(requestIdMiddleware, accessLog, securityHeaders);
  app.use('/api', express.json({ limit: '16kb' }), createApiRouter({ config, sessions, plans, now }));
  if (config.staticDir && existsSync(join(config.staticDir, 'index.html'))) serveStatic(app, config.staticDir);
  app.use(errorHandler);
  return { app, plans, sessions };
}
