import { statSync } from 'node:fs';
import type { ServerConfig } from '../config/env.js';
import { AppError } from '../http/errors.js';
import { BudgetLedger, taipeiDay } from './ledger.js';

export type OpenAIConfig = ServerConfig['openai'];
/** LLM 與 TTS 共用 concurrency=1；排隊完成後再次查 gate，預扣完成才可進網路。 */
export class RealProviderRuntime {
  readonly ledger: BudgetLedger | null;
  private notice: { day: string; message: string } | null = null;
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly config: OpenAIConfig, private readonly now = Date.now) {
    this.ledger = !config.reason && (config.llm === 'openai' || config.tts === 'openai') ? new BudgetLedger(config.ledgerPath, config.budget, now) : null;
  }
  reason(): string | null {
    if (this.config.reason) return this.config.reason;
    if (this.config.killSwitch()) return '緊急停止開關已啟用，真實供應商已停用。';
    try { statSync(this.config.killSwitchFile); return '停止檔已存在，真實供應商已停用。'; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return '無法檢查停止檔，真實供應商已停用。'; }
    return this.ledger?.check() ?? null;
  }
  statusReason(): string | null {
    return this.reason() ?? (this.notice?.day === taipeiDay(this.now()) ? this.notice.message : null);
  }
  async claimPlan(signal: AbortSignal): Promise<void> {
    return this.serial(signal, () => this.charge({ usd: 0, plans: 1 }, async () => ({ value: undefined, usd: 0 })));
  }
  async serial<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (signal.aborted) throw signal.reason;
      const reason = this.reason();
      if (reason) throw new AppError('FEATURE_RESTRICTED', { message: reason });
      return await work();
    } finally { release(); }
  }
  /** 預算面拒絕：保留當日可讀原因（設定頁顯示），不發請求、不寫帳。 */
  refuse(message: string): never {
    this.notice = { day: taipeiDay(this.now()), message };
    throw new AppError('QUOTA_EXCEEDED', { message });
  }
  async charge<T>(cost: { usd: number; plans?: number; graphemes?: number }, work: () => Promise<{ value: T; usd: number }>): Promise<T> {
    if (!this.ledger) throw new AppError('FEATURE_RESTRICTED');
    let reservation;
    try { reservation = this.ledger.reserve(cost); }
    catch { this.refuse(this.ledger.reason ?? '今日或總預算已達上限，請使用示範模式或稍後再試。'); }
    try {
      const result = await work();
      this.ledger.commit(reservation, result.usd);
      return result.value;
    } catch (error) { this.ledger.retain(reservation); throw error; }
  }
}
