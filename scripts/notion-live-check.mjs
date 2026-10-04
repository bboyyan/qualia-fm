/** Opt-in external L1 check only. Default invocation does not construct a client or read a token. */
import { pathToFileURL } from 'node:url';

const PAGE_ID = '3ef20e2b5b19815d8ecdeb052f5d164e';
const CONFIRM = '--confirm-write-one-test-row';
async function realLedger() {
  // Requires pnpm build. Token is read only by the server adapter from NOTION_TOKEN.
  const { NotionLedger, createNotionHttpClient } = await import('../apps/server/dist/ledger/notion.js');
  return new NotionLedger(createNotionHttpClient());
}

export async function runNotionLiveCheck(argv, makeLedger = realLedger, output = (message) => process.stdout.write(`${message}\n`)) {
  if (argv.length !== 1 || argv[0] !== CONFIRM) {
    output(`未執行：不讀取 token、不連線、不寫入。外部管理者確認 L1 授權後，先 pnpm build，再以 NOTION_TOKEN 環境變數執行 node scripts/notion-live-check.mjs ${CONFIRM}。`);
    return;
  }
  const ledger = await makeLedger();
  const receipt = await ledger.append({
    date: new Date().toISOString(),
    seed: 'TEST fake seed',
    recommendation: 'TEST fake recommendation',
    rating: '還行',
    reason: 'TEST fake data only; validation row, not a real preference.',
  });
  const anchor = receipt.rowId.replaceAll('-', '');
  output(`測試列（TEST）：https://app.notion.com/p/${PAGE_ID}#${anchor}`);
  output('僅寫入一列；種子與原因保留 TEST 標記，帳本 reader 會排除。請管理者在 PR 補上此連結與「測試列」標記；不要填真實偏好。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runNotionLiveCheck(process.argv.slice(2)).catch(() => {
    process.stderr.write('TEST 檢查未完成：請核對已 build、NOTION_TOKEN 環境變數及固定帳本權限；未自動重試。若寫入結果不明，請先在固定帳本確認 TEST 列，避免重複寫入。\n');
    process.exitCode = 1;
  });
}
