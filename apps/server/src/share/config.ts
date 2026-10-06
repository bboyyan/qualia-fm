/**
 * 分享設定（BRA-129）。獨立於 config/env.ts，讓本票不動其他開著的 PR 也在改的設定檔。
 * SHARE_PUBLIC_ENABLED 只有字面 'true' 才開（L2，需曄當次同意）；未設、空字串或其他值一律關。
 */
import { resolve } from 'node:path';

export interface ShareConfig {
  /** 分享紀錄的本機 JSON 檔（絕對路徑）；null＝只存在記憶體（只有 NODE_ENV=test 未設定時）。 */
  readonly path: string | null;
  /** 公開唯讀端點（/api/public/share/:code）；關閉時整個 /api/public 回 404。 */
  readonly publicEnabled: boolean;
}

/** 預設：記憶體、公開關閉。createApp 沒拿到設定時用這個（fail closed）。 */
export const DEFAULT_SHARE_CONFIG: ShareConfig = { path: null, publicEnabled: false };

export function loadShareConfig(source: Record<string, string | undefined>, nodeEnv: string): ShareConfig {
  const path = source.SHARE_STORE_PATH?.trim();
  return {
    path: path ? resolve(path) : nodeEnv === 'test' ? null : resolve('data/share-links.json'),
    publicEnabled: source.SHARE_PUBLIC_ENABLED === 'true',
  };
}
