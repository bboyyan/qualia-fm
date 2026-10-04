import { afterEach, beforeEach, vi } from 'vitest';

// 模組載入前與每個測試開始都封鎖，避免 singleton 捕捉到原生 fetch。
const blockNetwork = () => { vi.stubGlobal('fetch', () => { throw new Error('測試禁止真實網路：請注入 fetchImpl。'); }); };
blockNetwork();
beforeEach(blockNetwork);
afterEach(() => { vi.unstubAllGlobals(); });
