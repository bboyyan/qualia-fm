import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { LedgerWarnings } from '../src/features/player/LedgerWarnings';

it('V4 renders the ledger failure as an accessible alert and keeps normal mock warnings quiet', () => {
  const html = renderToStaticMarkup(createElement(LedgerWarnings, { warnings: ['未讀到帳本：本輪只用種子曲。'] }));
  expect(html).toContain('role="alert"');
  expect(html).toContain('未讀到帳本');
  expect(html).toContain('本輪只用種子曲');
  expect(renderToStaticMarkup(createElement(LedgerWarnings, { warnings: ['TEST MOCK'] }))).toBe('');
});
