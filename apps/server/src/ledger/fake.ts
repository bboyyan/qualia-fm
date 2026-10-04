import { LedgerRowSchema, type LedgerRow, type FeedbackReceipt } from '@qualia/contracts';
import type { FeedbackLedger } from './types.js';

/** Volatile TEST ledger. Never calls a network service or persists preferences. */
export class InMemoryLedger implements FeedbackLedger {
  private readonly rows: LedgerRow[] = [];
  async read(): Promise<LedgerRow[]> { return this.rows.map((row) => ({ ...row })); }
  async append(row: LedgerRow): Promise<FeedbackReceipt> {
    this.rows.push(LedgerRowSchema.parse(row));
    return { mode: 'fake', rowId: `TEST-${this.rows.length}` };
  }
}
