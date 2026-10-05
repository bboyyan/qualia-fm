/** 後端環境設定：不支援的播放模式拒絕啟動；Spotify 開關為嚴格閘門（缺設定即拒絕啟動）；OpenAI 缺設定明示降級。
 * 金鑰不進錯誤、日誌或 Vite。
 */
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import type { BudgetLimits } from '../budget/ledger.js';

const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);
const int = (fallback: number, min: number, max: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().min(min).max(max).default(fallback));
const flag = z.preprocess(emptyToUndefined, z.enum(['true', 'false']).default('false'));
/** 官方 audio/speech 文件：instructions「Does not work with tts-1 or tts-1-hd」。 */
const TTS_MODELS_WITHOUT_INSTRUCTIONS: ReadonlySet<string> = new Set(['tts-1', 'tts-1-hd']);
/** 聲線指示上限（Unicode code points）；預設 B2 instr-zh 約 170 字，留足調整空間也避免誤貼長文。 */
const MAX_TTS_INSTRUCTIONS_CHARS = 1500;
const blankToUndefined = (value: unknown): unknown => (typeof value === 'string' && value.trim() === '' ? undefined : value);
/** 曄的 Qualia Loved 歌單（非秘密 ID）；可用 SPOTIFY_LOVED_PLAYLIST_ID 覆寫。 */
const DEFAULT_LOVED_PLAYLIST_ID = '0dF9anAJZv0IotD6lo2kl2';
/** 本服務實際處理 Spotify 回呼的路徑；redirect URI 必須指向其中之一。 */
export const SPOTIFY_CALLBACK_PATHS: readonly string[] = ['/callback', '/api/auth/spotify/callback'];
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '[::1]']);

const EnvSchema = z.object({
  NODE_ENV: z.preprocess(emptyToUndefined, z.enum(['development', 'test', 'production']).default('development')),
  PORT: int(8080, 1, 65535),
  APP_ORIGIN: z.preprocess(emptyToUndefined, z.url().default('http://127.0.0.1:5173')),
  PROVIDER_MODE: z.preprocess(emptyToUndefined, z.enum(['mock', 'licensed', 'spotify', 'external']).default('mock')),
  LLM_PROVIDER: z.preprocess(emptyToUndefined, z.enum(['mock', 'openai']).default('mock')),
  TTS_PROVIDER: z.preprocess(emptyToUndefined, z.enum(['mock', 'openai']).default('mock')),
  SPOTIFY_ENABLED: flag,
  SPOTIFY_DJ_APPROVED: flag,
  SPOTIFY_CLIENT_ID: z.preprocess(blankToUndefined, z.string().optional()),
  SPOTIFY_REDIRECT_URI: z.preprocess(blankToUndefined, z.string().optional()),
  SPOTIFY_TOKEN_ENC_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  SPOTIFY_TOKEN_FILE: z.preprocess(blankToUndefined, z.string().default('./data/spotify-token.enc')),
  SPOTIFY_APPROVAL_REFERENCE: z.preprocess(blankToUndefined, z.string().max(300).optional()),
  SPOTIFY_OWNER_USER_ID: z.preprocess(blankToUndefined, z.string().optional()),
  SPOTIFY_LOVED_PLAYLIST_ID: z.preprocess(blankToUndefined, z.string().regex(/^[A-Za-z0-9]{22}$/).default(DEFAULT_LOVED_PLAYLIST_ID)),
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
  OPENAI_TTS_INSTRUCTIONS: z.preprocess(blankToUndefined, z.string()
    .refine((value) => [...value].length <= MAX_TTS_INSTRUCTIONS_CHARS).optional()),
  OPENAI_REAL_CALLS_APPROVED: flag,
  REAL_PROVIDERS_KILL_SWITCH: flag,
  OPENAI_MAX_OUTPUT_TOKENS: int(4096, 256, 16384),
  PROVIDER_TIMEOUT_MS: int(30000, 1, 60000),
  TTS_TIMEOUT_MS: int(30000, 1, 60000),
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
  gates: { spotifyEnabled: boolean; spotifyDjApproved: boolean };
  spotify: SpotifyConfig;
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
    /** 覆寫預設聲線指示；未設時 TTS provider 使用內建 B2 instructions。 */
    ttsInstructions: string | undefined;
    reason: string | null; killSwitch: () => boolean; killSwitchFile: string;
    maxOutputTokens: number; providerTimeoutMs: number; ttsTimeoutMs: number;
    inputPrice: number | undefined; outputPrice: number | undefined; ttsPrice: number | undefined;
    ledgerPath: string; budget: BudgetLimits;
    cacheDir: string; cacheTtlHours: number; cacheMaxMb: number;
  };
}

export interface SpotifyConfig {
  /** 只從 SPOTIFY_CLIENT_ID 讀取，程式不寫死。 */
  readonly clientId: string | undefined;
  readonly redirectUri: string | undefined;
  /** 32 bytes；只在記憶體，不進錯誤訊息或日誌。 */
  readonly tokenKey: Buffer | undefined;
  readonly tokenFile: string;
  readonly approvalReference: string | undefined;
  readonly lovedPlaylistId: string;
  /**
   * 唯一能成為擁有者的 Spotify 帳號 id（/v1/me 的 id，非秘密）。未設定＝拒絕任何連結（fail closed）。
   * 開發者 allowlist 擋不住佔位：不在 allowlist 的帳號仍可能完成 OAuth。
   */
  readonly ownerUserId: string | undefined;
}

/** Spotify 帳號 id 的寬鬆格式檢查（英數與 . _ -）；只用來擋明顯打錯，比對以 /v1/me 為準。 */
export const SPOTIFY_USER_ID = /^[A-Za-z0-9._-]{1,128}$/;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

type ParsedEnv = z.infer<typeof EnvSchema>;

/** Spotify 加密金鑰：base64（44 字）或 hex（64 字），解碼後必須剛好 32 bytes；否則視為無效。 */
function decodeTokenKey(value: string | undefined): Buffer | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const decoded = /^[0-9a-fA-F]{64}$/.test(trimmed) ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64');
  return decoded.length === 32 ? decoded : undefined;
}

/** HTTPS，或明確 loopback IP 的 HTTP（Spotify 不接受 localhost）；路徑必須是本服務處理的回呼。 */
function isAcceptableRedirect(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const transportOk = url.protocol === 'https:' ? url.hostname !== 'localhost' : url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  return transportOk && !url.search && !url.hash && SPOTIFY_CALLBACK_PATHS.includes(url.pathname);
}

/**
 * Spotify 嚴格閘門（fail closed）。預設全關＝與既有行為相同。
 * SPOTIFY_ENABLED=true 需 Client ID、redirect URI、加密金鑰齊全且有效；
 * SPOTIFY_DJ_APPROVED=true 另需 SPOTIFY_ENABLED=true 與可追溯的 SPOTIFY_APPROVAL_REFERENCE。
 * 錯誤訊息只點名變數，不回顯值。
 */
function assertSpotifyGate(env: ParsedEnv): void {
  if (env.SPOTIFY_DJ_APPROVED === 'true') {
    if (env.SPOTIFY_ENABLED !== 'true') throw new ConfigError('SPOTIFY_DJ_APPROVED=true is refused: SPOTIFY_ENABLED=true is required.');
    if (!env.SPOTIFY_APPROVAL_REFERENCE?.trim()) throw new ConfigError('SPOTIFY_DJ_APPROVED=true is refused: SPOTIFY_APPROVAL_REFERENCE (traceable approval) is empty.');
  }
  if (env.SPOTIFY_ENABLED !== 'true') return;
  const missing = [
    !env.SPOTIFY_CLIENT_ID || !/^[A-Za-z0-9]{16,64}$/.test(env.SPOTIFY_CLIENT_ID) ? 'SPOTIFY_CLIENT_ID' : null,
    !env.SPOTIFY_REDIRECT_URI || !isAcceptableRedirect(env.SPOTIFY_REDIRECT_URI) ? 'SPOTIFY_REDIRECT_URI' : null,
    !decodeTokenKey(env.SPOTIFY_TOKEN_ENC_KEY) ? 'SPOTIFY_TOKEN_ENC_KEY' : null,
    // 未設定可以啟動（連結會被拒絕）；設定了但格式不對＝打錯，拒絕啟動。
    env.SPOTIFY_OWNER_USER_ID !== undefined && !SPOTIFY_USER_ID.test(env.SPOTIFY_OWNER_USER_ID) ? 'SPOTIFY_OWNER_USER_ID' : null,
  ].filter((name): name is string => name !== null);
  if (missing.length > 0) {
    throw new ConfigError(`SPOTIFY_ENABLED=true is refused: missing or invalid ${missing.join(', ')} (redirect must be HTTPS or a loopback IP and end in ${SPOTIFY_CALLBACK_PATHS.join(' or ')}; key must decode to 32 bytes).`);
  }
}

/** Gates that this build refuses to start with. */
function assertSupported(env: ParsedEnv): void {
  assertSpotifyGate(env);
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
      ? 'OPENAI_TTS_MODEL 不支援 instructions（台灣國語聲線指示），已降級為 mock。'
    // 相對路徑會隨啟動目錄改變，換目錄重啟等於拿到新的零帳本；真實呼叫一律要求絕對路徑。
    : !isAbsolute(env.BUDGET_LEDGER_PATH) ? 'BUDGET_LEDGER_PATH 必須是絕對路徑，已降級為 mock。' : null;
  return {
    openai: {
      llm: env.LLM_PROVIDER, tts: env.TTS_PROVIDER, apiKey: env.OPENAI_API_KEY,
      textModel: env.OPENAI_TEXT_MODEL, ttsModel: env.OPENAI_TTS_MODEL, voice: env.OPENAI_TTS_VOICE,
      ttsInstructions: env.OPENAI_TTS_INSTRUCTIONS,
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
    gates: { spotifyEnabled: env.SPOTIFY_ENABLED === 'true', spotifyDjApproved: env.SPOTIFY_DJ_APPROVED === 'true' },
    spotify: {
      clientId: env.SPOTIFY_CLIENT_ID,
      redirectUri: env.SPOTIFY_REDIRECT_URI,
      tokenKey: decodeTokenKey(env.SPOTIFY_TOKEN_ENC_KEY),
      tokenFile: env.SPOTIFY_TOKEN_FILE,
      approvalReference: env.SPOTIFY_APPROVAL_REFERENCE?.trim(),
      ownerUserId: env.SPOTIFY_OWNER_USER_ID,
      lovedPlaylistId: env.SPOTIFY_LOVED_PLAYLIST_ID,
    },
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
