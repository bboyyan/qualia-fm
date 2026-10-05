import { z } from 'zod';
import type { EditorialPlanner, PlannerContext } from '../types.js';
import type { EditorialInput } from '../../services/editorialInput.js';
import type { OpenAIConfig, RealProviderRuntime } from '../../budget/runtime.js';
import { AppError } from '../../http/errors.js';
import { openAIRequest } from './http.js';
import { PLAN_JSON_SCHEMA, SYSTEM_PROMPT } from './resources.js';
import { POOL_MAX, POOL_MIN } from '../../services/candidatePool.js';

/**
 * 輸入 token 上界＝完整請求 JSON 的 UTF-8 位元組數＋固定框架餘裕。
 * BPE token 至少對應 1 個位元組，所以位元組數本身已是內容 token 的上界（中文約 3 位元組／字、
 * 實際約 1 token／字，已高估約 3 倍）；餘裕只需涵蓋每則訊息的框架 token 與 schema 轉成內部
 * 提示的差額。原本 8192 會讓輸入預扣再翻倍，改為 2048 仍保守；實際超出時 ledger 會持久 halted。
 */
export const REQUEST_OVERHEAD_TOKENS = 2048;
/** 單次 LLM 呼叫預扣不得超過每日額度的此比例，避免貴模型或過大 max_output_tokens 一次吃光日額。 */
export const MAX_CALL_SHARE_OF_DAILY = 0.1;
/**
 * BRA-127 候選池上限隨輸出 token 上限調整，避免 12 首加厚台詞被截斷成無效 JSON（截斷＝兩次修復都失敗→改用 MOCK）。
 * 每首約 450 token（繁中台詞約 1 token／字，含 JSON 欄位）保守估，另留 600 給 analysis／warnings。
 */
export const TOKENS_PER_CANDIDATE = 450;
export const DRAFT_FIXED_TOKENS = 600;
export function candidateLimitFor(maxOutputTokens: number): number {
  const fits = Math.floor((maxOutputTokens - DRAFT_FIXED_TOKENS) / TOKENS_PER_CANDIDATE);
  return Math.min(POOL_MAX, Math.max(POOL_MIN, fits));
}

const responseSchema = z.object({
  output: z.array(z.object({ type: z.string(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() })),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
});

/** 未確認 strict 模式支援的字串長度關鍵字不送出；長度仍由 PlanDraftSchema 在 server 端驗證。 */
const UNSENT_KEYWORDS = new Set(['minLength', 'maxLength']);
function strictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictSchema);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(Object.entries(node).filter(([key]) => !UNSENT_KEYWORDS.has(key)).map(([key, value]) => [key, strictSchema(value)]));
}
const SENT_SCHEMA = strictSchema(PLAN_JSON_SCHEMA);

export function estimateLlmReservation(body: string, config: OpenAIConfig): { inputTokens: number; usd: number } {
  const inputTokens = Buffer.byteLength(body, 'utf8') + REQUEST_OVERHEAD_TOKENS;
  return { inputTokens, usd: (inputTokens * (config.inputPrice ?? 0) + config.maxOutputTokens * (config.outputPrice ?? 0)) / 1e6 };
}

export class OpenAIEditorialPlanner implements EditorialPlanner {
  readonly kind = 'real' as const;

  constructor(private readonly config: OpenAIConfig, private readonly runtime: RealProviderRuntime, private readonly fetchImpl: typeof fetch) {}

  static requestBody(config: OpenAIConfig, input: EditorialInput) {
    return {
      model: config.textModel, max_output_tokens: config.maxOutputTokens, store: false,
      input: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify({ editorialInput: input, candidateLimit: candidateLimitFor(config.maxOutputTokens), candidateMin: POOL_MIN, requestedCount: 5 }) }],
      text: { format: { type: 'json_schema', name: 'plan_draft', strict: true, schema: SENT_SCHEMA } },
    };
  }

  async draft(input: EditorialInput, context: PlannerContext): Promise<unknown> {
    if (context.realAllowed === false || this.config.llm !== 'openai' || !this.config.textModel || !this.config.apiKey || !this.config.inputPrice || !this.config.outputPrice) throw new AppError('FEATURE_RESTRICTED');
    return this.runtime.serial(context.signal, async () => {
      const body = OpenAIEditorialPlanner.requestBody(this.config, input);
      const { usd } = estimateLlmReservation(JSON.stringify(body), this.config);
      const cap = this.config.budget.dailyUsd * MAX_CALL_SHARE_OF_DAILY;
      if (usd > cap) this.runtime.refuse(`單次預扣 US$${usd.toFixed(4)} 超過每日預算的 ${MAX_CALL_SHARE_OF_DAILY * 100}%，請改用較便宜的模型或調低 OPENAI_MAX_OUTPUT_TOKENS。`);
      return this.runtime.charge({ usd }, async () => {
        const response = responseSchema.parse(await openAIRequest(this.fetchImpl, this.config.apiKey!, 'responses', body, context.signal, this.config.providerTimeoutMs, (res) => res.json()));
        const contents = response.output.flatMap((item) => item.content ?? []);
        if (contents.some((item) => item.type === 'refusal')) throw new AppError('MODEL_REFUSED');
        const text = contents.filter((item) => item.type === 'output_text').map((item) => item.text ?? '').join('');
        const actual = (response.usage.input_tokens * this.config.inputPrice! + response.usage.output_tokens * this.config.outputPrice!) / 1e6;
        // JSON 與 schema 修復次數仍交給 PlanService；截斷（incomplete）或無效 JSON 都視為無效草稿。
        let value: unknown;
        try { value = JSON.parse(text); } catch { value = null; }
        return { value, usd: actual };
      });
    });
  }
}
