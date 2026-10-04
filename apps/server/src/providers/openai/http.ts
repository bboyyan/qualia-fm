import { AppError } from '../../http/errors.js';

/** 固定端點，禁止重新導向；錯誤不傳遞供應商本文、金鑰或原始例外。 */
export async function openAIRequest<T>(fetchImpl: typeof fetch, apiKey: string, path: 'responses' | 'audio/speech', body: unknown, parent: AbortSignal, timeout: number, read: (response: Response) => Promise<T>): Promise<T> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(timeout)]);
  if (signal.aborted) throw new AppError('PLAN_TIMEOUT', { message: '供應商逾時，保留文字介紹，請稍後再試。' });
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new AppError('PLAN_TIMEOUT', { message: '供應商逾時，保留文字介紹，請稍後再試。' }));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([aborted, (async () => {
      const response = await fetchImpl(`https://api.openai.com/v1/${path}`, {
        method: 'POST', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new AppError('FEATURE_RESTRICTED', { message: 'OpenAI 暫時無法使用，請使用示範模式或稍後再試。' });
      return read(response);
    })()]);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('FEATURE_RESTRICTED', { message: 'OpenAI 回應無法使用，請使用示範模式或稍後再試。' });
  } finally { signal.removeEventListener('abort', onAbort); }
}
