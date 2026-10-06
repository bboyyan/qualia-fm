/**
 * 內部分享連結（BRA-129）：`<同一個 app>/?share=<短碼>`。只有已登入的同一個 app 能解析（伺服器要求 session）；
 * 不是公開連結（公開落地屬 L2，未開放）。
 */
import { SHARE_CODE, SHARE_QUERY_PARAM } from '@qualia/contracts';

export function readShareCode(search: string): string | null {
  const code = new URLSearchParams(search).get(SHARE_QUERY_PARAM);
  return code && SHARE_CODE.test(code) ? code : null;
}

export function internalShareUrl(origin: string, code: string): string {
  return `${origin}/?${SHARE_QUERY_PARAM}=${encodeURIComponent(code)}`;
}

/** 讀完短碼後清掉網址參數，重新整理不會重複記「開啟」。 */
export function urlWithoutShare(pathname: string, search: string, hash: string): string {
  const params = new URLSearchParams(search);
  params.delete(SHARE_QUERY_PARAM);
  const rest = params.toString();
  return `${pathname}${rest ? `?${rest}` : ''}${hash}`;
}
