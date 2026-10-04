import { InlineRecovery } from '../../ui/Feedback';

export function LedgerWarnings({ warnings }: { warnings: readonly string[] }) {
  const warning = warnings.find((message) => message.startsWith('未讀到帳本'));
  return warning ? <InlineRecovery tone="warning" title="未讀到帳本" testId="ledger-warning">{warning}</InlineRecovery> : null;
}
