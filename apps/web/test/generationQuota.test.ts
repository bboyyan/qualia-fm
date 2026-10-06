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

it('伺服器重啟後 NOT_FOUND 即使 retryable:false 仍提供重新開台', () => {
  // renderFailure 只有 INTERNAL 為 true，忠實保留伺服器 NOT_FOUND 的 false。
  const html = renderFailure('NOT_FOUND');
  expect(html).toContain(ERROR_MESSAGES.NOT_FOUND);
  expect(html).toContain('再試一次');
  expect(html).toContain('你的輸入已保留。');
});

it('歷史不可用明示人工修復與未扣額度，不提供重試', () => {
  const html = renderFailure('HISTORY_UNAVAILABLE');
  expect(html).toContain('開台歷史檔讀不到或已損毀，需要人工修復後才能開台；本次未扣額度。');
  expect(html).not.toContain('再試一次');
});
