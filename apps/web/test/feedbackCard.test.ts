import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { FeedbackCard } from '../src/features/player/FeedbackCard';
import { FeedbackFormModel } from '../src/features/player/feedbackForm';

it('renders three rating buttons, a labelled optional reason and submit/skip controls', () => {
  const model = new FeedbackFormModel({ showId: 'TEST-show', segmentId: 'TEST-segment' }, async () => ({ mode: 'fake', rowId: 'TEST-row' }), () => undefined, () => undefined);
  const html = renderToStaticMarkup(createElement(FeedbackCard, { model }));
  for (const rating of ['愛', '還行', '不對']) expect(html).toContain(`>${rating}</button>`);
  expect(html).toContain('aria-pressed="false"');
  expect(html).toContain('一句質地原因（可略過）');
  expect(html.toLowerCase()).toContain('maxlength="200"');
  expect(html).toContain('送出回饋');
  expect(html).toContain('略過回饋');
  expect(html).toContain('TEST 假帳本');
});
