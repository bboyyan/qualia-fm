import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

const amount = z.number().finite().nonnegative();
const daySchema = z.strictObject({ usd: amount, plans: z.number().int().nonnegative(), graphemes: z.number().int().nonnegative() });
const schema = z.strictObject({ version: z.literal(1), halted: z.boolean().default(false), totalUsd: amount, days: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), daySchema) }).refine((data) => Math.abs(data.totalUsd - Object.values(data.days).reduce((sum, day) => sum + day.usd, 0)) < 1e-8);
export interface BudgetLimits { dailyUsd: number; totalUsd: number; plansPerDay: number; graphemesPerDay: number }
export interface Reservation { readonly day: string; readonly usd: number }
export const taipeiDay = (now: number): string => new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
const round = (usd: number): number => Math.round(usd * 1e9) / 1e9;

/** 單一程序帳本。未完成的預扣於重啟後視為已支出，避免已計費的請求被重複放行。 */
export class BudgetLedger {
  private data: z.infer<typeof schema> = { version: 1, halted: false, totalUsd: 0, days: {} };
  private readonly active = new Set<Reservation>();
  reason: string | null = null;
  constructor(private readonly path: string, private readonly limits: BudgetLimits, private readonly now = Date.now) {
    try { this.data = schema.parse(JSON.parse(readFileSync(path, 'utf8'))); if (this.data.halted) this.reason = '實際用量超出預扣，真實供應商已停用。'; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        try { this.save(); } catch { /* save 已標記 fail closed */ }
      } else this.reason = '預算帳本無法讀取或已損毀，真實供應商已停用。';
    }
  }
  check(): string | null {
    if (!this.reason) {
      try { this.data = schema.parse(JSON.parse(readFileSync(this.path, 'utf8'))); if (this.data.halted) this.reason = '實際用量超出預扣，真實供應商已停用。'; }
      catch { this.reason = '預算帳本無法讀取或已損毀，真實供應商已停用。'; }
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
      this.reason = '實際用量超出預扣，真實供應商已停用。';
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
  private save(): void {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      writeFileSync(temporary, JSON.stringify(this.data), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.path);
    } catch {
      this.reason = '預算帳本寫入失敗，真實供應商已停用。';
      throw new Error(this.reason);
    }
  }
}
