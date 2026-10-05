import { AppError } from '../../http/errors.js';

type ProviderCode = `HTTP_${number}` | 'NETWORK_ERROR' | 'INVALID_RESPONSE' | 'INVALID_AUDIO' | 'TIMEOUT';

/** 僅由本地固定碼與 HTTP status 組成；不讀取錯誤本文、headers 或原始例外訊息。 */
export class OpenAIRequestError extends AppError {
  providerAttempts = 1;
  constructor(readonly providerCode: ProviderCode, readonly providerStatus: number | null, readonly providerRetryable: boolean, timeout = false) {
    super(timeout ? 'PLAN_TIMEOUT' : 'FEATURE_RESTRICTED', {
      message: timeout ? '供應商逾時，保留文字介紹，請稍後再試。' : `OpenAI 供應商失敗（${providerCode}），請稍後再試。`,
    });
  }
}

export const providerTimeout = () => new OpenAIRequestError('TIMEOUT', null, false, true);

/** 固定端點，禁止重新導向；錯誤不傳遞供應商本文、金鑰或原始例外。 */
export async function openAIRequest<T>(fetchImpl: typeof fetch, apiKey: string, path: 'responses' | 'audio/speech', body: unknown, parent: AbortSignal, timeout: number, read: (response: Response) => Promise<T>): Promise<T> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(timeout)]);
  if (signal.aborted) throw providerTimeout();
  let receivedResponse = false;
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(providerTimeout());
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([aborted, (async () => {
      const response = await fetchImpl(`https://api.openai.com/v1/${path}`, {
        method: 'POST', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      receivedResponse = true;
      if (!response.ok) throw new OpenAIRequestError(`HTTP_${response.status}`, response.status, [408, 500, 502, 503, 504].includes(response.status));
      return read(response);
    })()]);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (signal.aborted) throw providerTimeout();
    const network = !receivedResponse && error instanceof TypeError;
    throw new OpenAIRequestError(network ? 'NETWORK_ERROR' : 'INVALID_RESPONSE', null, network);
  } finally { signal.removeEventListener('abort', onAbort); }
}
