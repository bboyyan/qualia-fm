import type { FeedbackReceipt, LedgerRow } from '@qualia/contracts';

export interface FeedbackLedger {
  read(signal?: AbortSignal): Promise<LedgerRow[]>;
  append(row: LedgerRow): Promise<FeedbackReceipt>;
}
