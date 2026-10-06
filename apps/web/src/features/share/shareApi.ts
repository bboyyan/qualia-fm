/**
 * 分享 API（BRA-129）。獨立於 api/client.ts（其他開著的 PR 也在改），但沿用同一個 session：
 * CSRF token 由 ApiClient.ensureSession() 取得，只存在記憶體。
 */
import type { z } from 'zod';
import { ErrorEnvelopeSchema, HEADERS, ShareCountsSchema, ShareViewSchema } from '@qualia/contracts';
import { ApiError, localError, type ApiClient } from '../../api/client';
import type { ShareApi } from './shareController';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createShareApi(api: Pick<ApiClient, 'ensureSession'>, fetchImpl: FetchLike = (i, init) => fetch(i, init)): ShareApi {
  async function send<T>(path: string, schema: z.ZodType<T>, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    const session = await api.ensureSession();
    const headers: Record<string, string> = method === 'POST' ? { [HEADERS.csrf]: session.csrfToken, 'Content-Type': 'application/json' } : {};
    let res: Response;
    try {
      res = await fetchImpl(path, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw localError('NETWORK_ERROR');
    }
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const envelope = ErrorEnvelopeSchema.safeParse(json);
      throw envelope.success ? new ApiError(envelope.data.error, res.status) : new ApiError(localError('INTERNAL').info, res.status);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw localError('INTERNAL', '服務回應格式不正確，請稍後再試。');
    return parsed.data;
  }
  const path = (code: string): string => `/api/share/${encodeURIComponent(code)}`;
  return {
    create: (request) => send('/api/share', ShareViewSchema, 'POST', request),
    get: (code) => send(path(code), ShareViewSchema, 'GET'),
    event: (code, kind) => send(`${path(code)}/events`, ShareCountsSchema, 'POST', { kind }),
  };
}
