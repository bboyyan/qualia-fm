/**
 * Server-only environment schema. Fails fast on anything this build cannot honour.
 * Secrets are never echoed in errors or logs; nothing here is exposed to Vite.
 */
import { z } from 'zod';

const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);
const int = (fallback: number, min: number, max: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().min(min).max(max).default(fallback));
const flag = z.preprocess(emptyToUndefined, z.enum(['true', 'false']).default('false'));

const EnvSchema = z.object({
  NODE_ENV: z.preprocess(emptyToUndefined, z.enum(['development', 'test', 'production']).default('development')),
  PORT: int(8080, 1, 65535),
  APP_ORIGIN: z.preprocess(emptyToUndefined, z.url().default('http://127.0.0.1:5173')),
  PROVIDER_MODE: z.preprocess(emptyToUndefined, z.enum(['mock', 'licensed', 'spotify', 'external']).default('mock')),
  LLM_PROVIDER: z.preprocess(emptyToUndefined, z.enum(['mock', 'openai']).default('mock')),
  TTS_PROVIDER: z.preprocess(emptyToUndefined, z.enum(['mock', 'openai']).default('mock')),
  SPOTIFY_ENABLED: flag,
  SPOTIFY_DJ_APPROVED: flag,
  PLAN_DEADLINE_MS: int(60_000, 1_000, 120_000),
  MAX_LLM_CALLS_PER_PLAN: int(2, 1, 2),
  MAX_CANDIDATES_PER_PLAN: int(10, 5, 10),
  PLAN_RATE_LIMIT_PER_HOUR: int(10, 1, 500),
  SESSION_RATE_LIMIT_PER_MIN: int(30, 1, 5_000),
  MOCK_TRACK_MS: int(30_000, 1_000, 600_000),
  MOCK_SPEECH_MS: int(4_000, 300, 30_000),
  MOCK_PHASE_MS: int(700, 0, 10_000),
  MOCK_SLOW_PHASE_MS: int(24_000, 0, 120_000),
  STATIC_DIR: z.preprocess(emptyToUndefined, z.string().optional()),
});

export interface ServerConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  appOrigin: string;
  allowedOrigins: readonly string[];
  secureCookies: boolean;
  mode: 'mock';
  gates: { spotifyEnabled: false; spotifyDjApproved: false };
  limits: {
    planDeadlineMs: number;
    maxLlmCallsPerPlan: number;
    maxCandidatesPerPlan: number;
    planRateLimitPerHour: number;
    sessionRateLimitPerMin: number;
  };
  mock: { trackMs: number; speechMs: number; phaseMs: number; slowPhaseMs: number };
  staticDir: string | undefined;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

type ParsedEnv = z.infer<typeof EnvSchema>;

/** Gates that this build refuses to start with. Spotify stays a disabled boundary (docs/05). */
function assertSupported(env: ParsedEnv): void {
  if (env.SPOTIFY_ENABLED === 'true') {
    throw new ConfigError('SPOTIFY_ENABLED=true is refused: Spotify G0-A/B/C gates have not passed and no Spotify adapter ships in this build.');
  }
  if (env.SPOTIFY_DJ_APPROVED === 'true') {
    throw new ConfigError('SPOTIFY_DJ_APPROVED=true is refused: it requires a traceable approval and is never set by the implementer.');
  }
  if (env.PROVIDER_MODE !== 'mock') {
    throw new ConfigError(`PROVIDER_MODE=${env.PROVIDER_MODE} is not implemented in this build (T01–T05 ship the mock adapter only).`);
  }
  if (env.LLM_PROVIDER !== 'mock' || env.TTS_PROVIDER !== 'mock') {
    throw new ConfigError('Real LLM/TTS providers are not implemented yet (T06/T07). Use LLM_PROVIDER=mock and TTS_PROVIDER=mock.');
  }
}

function originsFor(env: ParsedEnv): string[] {
  const own = [`http://127.0.0.1:${env.PORT}`, `http://localhost:${env.PORT}`];
  const list = env.NODE_ENV === 'production' ? [env.APP_ORIGIN] : [env.APP_ORIGIN, ...own];
  return [...new Set(list.map((o) => new URL(o).origin))];
}

export function loadConfig(source: Record<string, string | undefined> = process.env): ServerConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new ConfigError(`Invalid server environment: ${fields}`);
  }
  const env = parsed.data;
  assertSupported(env);
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    appOrigin: new URL(env.APP_ORIGIN).origin,
    allowedOrigins: originsFor(env),
    secureCookies: env.APP_ORIGIN.startsWith('https://'),
    mode: 'mock',
    gates: { spotifyEnabled: false, spotifyDjApproved: false },
    limits: {
      planDeadlineMs: env.PLAN_DEADLINE_MS,
      maxLlmCallsPerPlan: env.MAX_LLM_CALLS_PER_PLAN,
      maxCandidatesPerPlan: env.MAX_CANDIDATES_PER_PLAN,
      planRateLimitPerHour: env.PLAN_RATE_LIMIT_PER_HOUR,
      sessionRateLimitPerMin: env.SESSION_RATE_LIMIT_PER_MIN,
    },
    mock: {
      trackMs: env.MOCK_TRACK_MS,
      speechMs: env.MOCK_SPEECH_MS,
      phaseMs: env.MOCK_PHASE_MS,
      slowPhaseMs: env.MOCK_SLOW_PHASE_MS,
    },
    staticDir: env.STATIC_DIR,
  };
}
