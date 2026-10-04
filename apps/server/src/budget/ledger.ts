import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { z } from 'zod';

const amount = z.number().finite().nonnegative();
const daySchema = z.strictObject({ usd: amount, plans: z.number().int().nonnegative(), graphemes: z.number().int().nonnegative() });
const schema = z.strictObject({ version: z.literal(1), halted: z.boolean().default(false), totalUsd: amount, days: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), daySchema) }).refine((data) => Math.abs(data.totalUsd - Object.values(data.days).reduce((sum, day) => sum + day.usd, 0)) < 1e-8);
export interface BudgetLimits { dailyUsd: number; totalUsd: number; plansPerDay: number; graphemesPerDay: number }
export interface Reservation { readonly day: string; readonly usd: number }
export const taipeiDay = (now: number): string => new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
const round = (usd: number): number => Math.round(usd * 1e9) / 1e9;
/** 首次建立帳本時一併寫入；之後帳本若不見但此檔仍在，代表帳本遺失而非首次啟用。 */
export const sentinelPathFor = (ledgerPath: string): string => `${ledgerPath}.initialized`;
const REASONS = {
  relative: 'BUDGET_LEDGER_PATH 必須是絕對路徑，真實供應商已停用。',
  corrupt: '預算帳本無法讀取或已損毀，真實供應商已停用。',
  missing: '預算帳本遺失（已初始化過，不會自動重建），真實供應商已停用；請人工核對帳單後依文件復原。',
  sentinel: '預算帳本初始化標記無法讀寫，真實供應商已停用。',
  halted: '實際用量超出預扣，真實供應商已停用。',
  write: '預算帳本寫入失敗，真實供應商已停用。',
} as const;
const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';

/**
 * 單一程序帳本。未完成的預扣於重啟後視為已支出，避免已計費的請求被重複放行。
 * 只在「帳本與 sentinel 都不存在」時建立零帳本；帳本遺失但 sentinel 仍在則 fail closed，需人工處理。
 */
export class BudgetLedger {
  private data: z.infer<typeof schema> = { version: 1, halted: false, totalUsd: 0, days: {} };
  private readonly active = new Set<Reservation>();
  reason: string | null = null;
  constructor(private readonly path: string, private readonly limits: BudgetLimits, private readonly now = Date.now) {
    this.reason = this.open();
  }
  check(): string | null {
    if (!this.reason) {
      try { this.data = this.readValid(); if (this.data.halted) this.reason = REASONS.halted; }
      catch { this.reason = REASONS.corrupt; }
    }
    return this.reason;
  }
  snapshot() { return structuredClone(this.data); }
  reserve(input: { usd: number; plans?: number; graphemes?: number }): Reservation {
    if (this.check()) throw new Error(this.reason!);
    const usd = Math.ceil(input.usd * 1e9) / 1e9;
    const plans = input.plans ?? 0;
    const graphemes = input.graphemes ?? 0;
    if (!Number.isFinite(usd) || usd < 0 || !Number.isInteger(plans) || plans < 0 || !Number.isInteger(graphemes) || graphemes < 0) throw new Error('預算參數無效');
    const day = taipeiDay(this.now());
    const old = this.data.days[day] ?? { usd: 0, plans: 0, graphemes: 0 };
    const next = { usd: round(old.usd + usd), plans: old.plans + plans, graphemes: old.graphemes + graphemes };
    if (next.usd > this.limits.dailyUsd || round(this.data.totalUsd + usd) > this.limits.totalUsd || next.plans > this.limits.plansPerDay || next.graphemes > this.limits.graphemesPerDay) throw new Error('今日或總預算已達上限，請使用示範模式或稍後再試。');
    this.data.days[day] = next;
    this.data.totalUsd = round(this.data.totalUsd + usd);
    this.save();
    const reservation = { day, usd };
    this.active.add(reservation);
    return reservation;
  }
  commit(reservation: Reservation, actualUsd: number): void {
    if (!this.active.has(reservation)) throw new Error('預扣不存在');
    if (this.check()) throw new Error(this.reason!);
    if (!Number.isFinite(actualUsd) || actualUsd < 0 || actualUsd > reservation.usd) {
      if (Number.isFinite(actualUsd) && actualUsd > reservation.usd) {
        this.data.totalUsd = round(this.data.totalUsd + actualUsd - reservation.usd);
        this.data.days[reservation.day]!.usd = round(this.data.days[reservation.day]!.usd + actualUsd - reservation.usd);
      }
      this.data.halted = true;
      this.save();
      this.reason = REASONS.halted;
      throw new Error(this.reason);
    }
    if (this.check()) throw new Error(this.reason!);
    const release = reservation.usd - actualUsd;
    this.data.totalUsd = round(this.data.totalUsd - release);
    this.data.days[reservation.day]!.usd = round(this.data.days[reservation.day]!.usd - release);
    this.save();
    this.active.delete(reservation);
  }
  /** 失敗可能仍被計費，保留完整預扣；只釋放記憶體中的追蹤。 */
  retain(reservation: Reservation): void { this.active.delete(reservation); }
  private open(): string | null {
    if (!isAbsolute(this.path)) return REASONS.relative;
    try { this.data = this.readValid(); }
    catch (error) { return isMissing(error) ? this.initialize() : REASONS.corrupt; }
    // 舊版升級：帳本已驗證合法但尚無 sentinel，補寫後才放行。
    const sentinel = this.sentinelExists();
    const sentinelReason = sentinel === null ? REASONS.sentinel : sentinel ? null : this.writeSentinel();
    return sentinelReason ?? (this.data.halted ? REASONS.halted : null);
  }
  /** 帳本 ENOENT：sentinel 存在＝遺失（拒絕）；兩者皆無＝首次啟用（先寫帳本再寫 sentinel）。 */
  private initialize(): string | null {
    const sentinel = this.sentinelExists();
    if (sentinel === null) return REASONS.sentinel;
    if (sentinel) return REASONS.missing;
    try { this.save(); } catch { return REASONS.write; }
    return this.writeSentinel();
  }
  /** true／false＝存在與否；null＝無法判斷（權限等），呼叫端一律 fail closed。 */
  private sentinelExists(): boolean | null {
    try { lstatSync(sentinelPathFor(this.path)); return true; }
    catch (error) { return isMissing(error) ? false : null; }
  }
  private writeSentinel(): string | null {
    const body = JSON.stringify({ version: 1, initializedAt: new Date(this.now()).toISOString() });
    try { this.atomicWrite(sentinelPathFor(this.path), body); return null; }
    catch { return REASONS.sentinel; }
  }
  private readValid(): z.infer<typeof schema> {
    return schema.parse(JSON.parse(readFileSync(this.path, 'utf8')));
  }
  private save(): void {
    try { this.atomicWrite(this.path, JSON.stringify(this.data)); }
    catch {
      this.reason = REASONS.write;
      throw new Error(this.reason);
    }
  }
  /** 私有 tmp（mode 600、wx）＋同目錄 rename；新目錄 mode 700。 */
  private atomicWrite(target: string, body: string): void {
    const temporary = `${target}.${randomUUID()}.tmp`;
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(temporary, body, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, target);
  }
}
