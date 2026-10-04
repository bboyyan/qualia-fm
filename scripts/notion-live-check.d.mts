import type { FeedbackLedger } from '../apps/server/src/ledger/types.js';
export function runNotionLiveCheck(argv: string[], makeLedger?: () => FeedbackLedger | Promise<FeedbackLedger>, output?: (message: string) => void): Promise<void>;
