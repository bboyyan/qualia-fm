/** 後端環境設定：不支援的播放模式／Spotify gate 拒絕啟動；OpenAI 缺設定明示降級。
 * 金鑰不進錯誤、日誌或 Vite。
 */
import { z } from 'zod';
import type { BudgetLimits } from '../budget/ledger.js';

const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);
const int = (fallback: number, min: number, max: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().min(min).max(max).default(fallback));
const flag = z.preprocess(emptyToUndefined, z.enum(['true', 'false']).default('false'));
/** 官方 audio/speech 文件：instructions「Does not work with tts-1 or tts-1-hd」。 */
const TTS_MODELS_WITHOUT_INSTRUCTIONS: ReadonlySet<string> = new Set(['tts-1', 'tts-1-hd']);

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
  OPENAI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  OPENAI_TEXT_MODEL: z.preprocess(emptyToUndefined, z.string().optional()),
  OPENAI_TTS_MODEL: z.preprocess(emptyToUndefined, z.string().optional()),
  OPENAI_TTS_VOICE: z.preprocess(emptyToUndefined, z.string().optional()),
  OPENAI_REAL_CALLS_APPROVED: flag,
  REAL_PROVIDERS_KILL_SWITCH: flag,
  OPENAI_MAX_OUTPUT_TOKENS: int(4096, 256, 16384),
  PROVIDER_TIMEOUT_MS: int(8000, 1, 60000),
  TTS_TIMEOUT_MS: int(15000, 1, 60000),
  BUDGET_DAILY_USD: z.preprocess(emptyToUndefined, z.coerce.number().positive().max(1).default(1)),
  BUDGET_TOTAL_USD: z.preprocess(emptyToUndefined, z.coerce.number().positive().max(10).default(10)),
  BUDGET_MAX_PLANS_PER_DAY: int(20, 1, 20),
  TTS_GRAPHEME_BUDGET_PER_DAY: int(4000, 1, 4000),
  BUDGET_LEDGER_PATH: z.preprocess(emptyToUndefined, z.string().default('./data/budget-ledger.json')),
  KILL_SWITCH_FILE: z.preprocess(emptyToUndefined, z.string().default('./data/KILL_SWITCH')),
  TTS_CACHE_DIR: z.preprocess(emptyToUndefined, z.string().default('./data/tts')),
  TTS_CACHE_TTL_HOURS: int(24, 1, 168),
  TTS_CACHE_MAX_MB: int(100, 1, 100),
  OPENAI_PRICE_INPUT_PER_1M_TOKENS: z.string().optional(),
  OPENAI_PRICE_OUTPUT_PER_1M_TOKENS: z.string().optional(),
  OPENAI_PRICE_TTS_PER_1M_CHARS: z.string().optional(),
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
  openai: {
    llm: 'mock' | 'openai'; tts: 'mock' | 'openai'; apiKey: string | undefined;
    textModel: string | undefined; ttsModel: string | undefined; voice: string | undefined;
    reason: string | null; killSwitch: () => boolean; killSwitchFile: string;
    maxOutputTokens: number; providerTimeoutMs: number; ttsTimeoutMs: number;
    inputPrice: number | undefined; outputPrice: number | undefined; ttsPrice: number | undefined;
    ledgerPath: string; budget: BudgetLimits;
    cacheDir: string; cacheTtlHours: number; cacheMaxMb: number;
  };
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
  const price = (value: string | undefined): number | undefined => {
    const number = Number(value);
    return value?.trim() && Number.isFinite(number) && number > 0 && number <= 100000 ? number : undefined;
  };
  const inputPrice = price(env.OPENAI_PRICE_INPUT_PER_1M_TOKENS);
  const outputPrice = price(env.OPENAI_PRICE_OUTPUT_PER_1M_TOKENS);
  const ttsPrice = price(env.OPENAI_PRICE_TTS_PER_1M_CHARS);
  const requested = env.LLM_PROVIDER === 'openai' || env.TTS_PROVIDER === 'openai';
  const reason = !requested ? null : !env.OPENAI_API_KEY ? '缺少 OPENAI_API_KEY，已降級為 mock。'
    : env.OPENAI_REAL_CALLS_APPROVED !== 'true' ? 'OpenAI 尚待簽收上限數字，已降級為 mock。'
    : (env.LLM_PROVIDER === 'openai' && (!env.OPENAI_TEXT_MODEL || !inputPrice || !outputPrice)) ||
      (env.TTS_PROVIDER === 'openai' && (!env.OPENAI_TTS_MODEL || !env.OPENAI_TTS_VOICE || !ttsPrice))
      ? 'OpenAI 模型、voice 或單價設定不完整，已降級為 mock。'
    : env.TTS_PROVIDER === 'openai' && TTS_MODELS_WITHOUT_INSTRUCTIONS.has(env.OPENAI_TTS_MODEL ?? '')
      ? 'OPENAI_TTS_MODEL 不支援 instructions（台灣國語聲線指示），已降級為 mock。' : null;
  return {
    openai: {
      llm: env.LLM_PROVIDER, tts: env.TTS_PROVIDER, apiKey: env.OPENAI_API_KEY,
      textModel: env.OPENAI_TEXT_MODEL, ttsModel: env.OPENAI_TTS_MODEL, voice: env.OPENAI_TTS_VOICE,
      reason, killSwitch: () => source.REAL_PROVIDERS_KILL_SWITCH === 'true', killSwitchFile: env.KILL_SWITCH_FILE,
      maxOutputTokens: env.OPENAI_MAX_OUTPUT_TOKENS, providerTimeoutMs: env.PROVIDER_TIMEOUT_MS, ttsTimeoutMs: env.TTS_TIMEOUT_MS,
      inputPrice, outputPrice, ttsPrice, ledgerPath: env.BUDGET_LEDGER_PATH,
      budget: { dailyUsd: env.BUDGET_DAILY_USD, totalUsd: env.BUDGET_TOTAL_USD, plansPerDay: env.BUDGET_MAX_PLANS_PER_DAY, graphemesPerDay: env.TTS_GRAPHEME_BUDGET_PER_DAY },
      cacheDir: env.TTS_CACHE_DIR, cacheTtlHours: env.TTS_CACHE_TTL_HOURS, cacheMaxMb: env.TTS_CACHE_MAX_MB,
    },
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
