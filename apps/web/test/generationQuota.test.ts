import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ERROR_MESSAGES, type ErrorCode } from '@qualia/contracts';
import { expect, it } from 'vitest';
import { GenerationView } from '../src/features/seed/GenerationView';
import type { GenerationState } from '../src/features/seed/generationController';

const noop = () => undefined;
const renderFailure = (code: ErrorCode) => {
  const state: GenerationState = {
    status: 'failed', phase: 'understanding', request: null, show: null, jobStatus: 'failed', longWait: false,
    error: { code, message: ERROR_MESSAGES[code], retryable: code === 'INTERNAL', requestId: 'req-test', retryAfterMs: null },
  };
  return renderToStaticMarkup(createElement(GenerationView, { state, seedText: '保留的感覺', onCancel: noop, onRetry: noop, onEdit: noop }));
};

it('配額滿顯示上限與保留輸入，不當成訊號故障或鼓勵立即重試', () => {
  const html = renderFailure('QUOTA_EXCEEDED');
  expect(html).toContain(ERROR_MESSAGES.QUOTA_EXCEEDED);
  expect(html).toContain('已達使用上限。');
  expect(html).toContain('你的輸入已保留。');
  expect(html).toContain('修改感覺');
  expect(html).not.toMatch(/SIGNAL LOST|服務暫時出了點問題|再試一次/);
});

it('一般內部錯誤仍顯示原本的故障與重試提示', () => {
  const html = renderFailure('INTERNAL');
  expect(html).toContain('SIGNAL LOST');
  expect(html).toContain(ERROR_MESSAGES.INTERNAL);
  expect(html).toContain('再試一次');
});
