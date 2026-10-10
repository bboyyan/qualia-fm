import { expect, it } from 'vitest';
import { AppError } from '../src/http/errors.js';
import { OpenAIRequestError, providerTimeout } from '../src/providers/openai/http.js';

it('timeout factory 保留逾時錯誤欄位、訊息與繼承關係', () => {
  const error = OpenAIRequestError.timeout();
  expect(error).toBeInstanceOf(OpenAIRequestError);
  expect(error).toBeInstanceOf(AppError);
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({
    code: 'PLAN_TIMEOUT', status: 504, retryAfterMs: null,
    providerCode: 'TIMEOUT', providerStatus: null, providerRetryable: false, providerAttempts: 1,
    message: '供應商逾時，保留文字介紹，請稍後再試。',
  });
  expect(providerTimeout()).toEqual(error);
});

it('network factory 保留可重試的安全網路錯誤', () => {
  const error = OpenAIRequestError.network();
  expect(error).toBeInstanceOf(OpenAIRequestError);
  expect(error).toBeInstanceOf(AppError);
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({
    code: 'FEATURE_RESTRICTED', status: 403, retryAfterMs: null,
    providerCode: 'NETWORK_ERROR', providerStatus: null, providerRetryable: true, providerAttempts: 1,
    message: 'OpenAI 供應商失敗（NETWORK_ERROR），請稍後再試。',
  });
});

it('invalidResponse factory 保留不可重試的安全回應錯誤', () => {
  const error = OpenAIRequestError.invalidResponse();
  expect(error).toBeInstanceOf(OpenAIRequestError);
  expect(error).toBeInstanceOf(AppError);
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({
    code: 'FEATURE_RESTRICTED', status: 403, retryAfterMs: null,
    providerCode: 'INVALID_RESPONSE', providerStatus: null, providerRetryable: false, providerAttempts: 1,
    message: 'OpenAI 供應商失敗（INVALID_RESPONSE），請稍後再試。',
  });
});

it('invalidAudio factory 保留不可重試的音訊錯誤並支援更新嘗試次數', () => {
  const error = OpenAIRequestError.invalidAudio();
  expect(error).toBeInstanceOf(OpenAIRequestError);
  expect(error).toBeInstanceOf(AppError);
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({
    code: 'FEATURE_RESTRICTED', status: 403, retryAfterMs: null,
    providerCode: 'INVALID_AUDIO', providerStatus: null, providerRetryable: false, providerAttempts: 1,
    message: 'OpenAI 供應商失敗（INVALID_AUDIO），請稍後再試。',
  });
  error.providerAttempts = 2;
  expect(error.providerAttempts).toBe(2);
  expect(OpenAIRequestError.invalidAudio().providerAttempts).toBe(1);
});

it.each([
  [408, true], [500, true], [502, true], [503, true], [504, true],
  [400, false], [401, false], [403, false], [429, false], [501, false], [599, false],
] as const)('httpStatus(%i) 保留 HTTP 診斷與 retryable=%s', (status, retryable) => {
  const error = OpenAIRequestError.httpStatus(status);
  expect(error).toBeInstanceOf(OpenAIRequestError);
  expect(error).toBeInstanceOf(AppError);
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({
    code: 'FEATURE_RESTRICTED', status: 403, retryAfterMs: null,
    providerCode: `HTTP_${status}`, providerStatus: status, providerRetryable: retryable, providerAttempts: 1,
    message: `OpenAI 供應商失敗（HTTP_${status}），請稍後再試。`,
  });
});
