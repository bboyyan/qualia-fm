import { expect, it } from 'vitest';
import type { FeedbackRequest } from '@qualia/contracts';
import { FeedbackFormModel } from '../src/features/player/feedbackForm';

it('requires a rating, records an empty reason and ignores repeated submits while pending', async () => {
  const rows: unknown[] = [];
  const completions: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const form = new FeedbackFormModel({ showId: 'TEST-show', segmentId: 'TEST-segment' }, async (request) => {
    rows.push(request);
    await pending;
    return { mode: 'fake', rowId: 'TEST-row' };
  }, (receipt) => completions.push(receipt.rowId), () => completions.push('skip'));
  await form.submit();
  expect(rows).toHaveLength(0);
  form.setRating('還行');
  const first = form.submit();
  await form.submit();
  form.skip();
  expect(form.getState().busy).toBe(true);
  expect(rows).toEqual([{ showId: 'TEST-show', segmentId: 'TEST-segment', rating: '還行', reason: '', clientRequestId: expect.any(String) }]);
  release();
  await first;
  expect(completions).toEqual(['TEST-row']);
});

it('keeps the rating/reason on failure, allows retry, and trims the submitted reason', async () => {
  let attempts = 0;
  let reason: string | undefined;
  const form = new FeedbackFormModel({ showId: 'TEST-show', segmentId: 'TEST-segment' }, async (request) => {
    attempts += 1;
    reason = request.reason;
    if (attempts === 1) throw new Error('TEST unavailable');
    return { mode: 'fake', rowId: 'TEST-row' };
  }, () => undefined, () => undefined);
  form.setRating('不對');
  form.setReason('  TEST reason  ');
  await form.submit();
  expect(form.getState()).toMatchObject({ rating: '不對', reason: '  TEST reason  ', busy: false, finished: false, error: expect.stringContaining('未能記錄') });
  await form.submit();
  expect([attempts, reason, form.getState().finished]).toEqual([2, 'TEST reason', true]);
});

it('skips the entire feedback without inventing a rating or writing a ledger row', async () => {
  let saved = 0;
  let skipped = 0;
  const form = new FeedbackFormModel({ showId: 'TEST-show', segmentId: 'TEST-segment' }, async () => {
    saved += 1;
    return { mode: 'fake', rowId: 'TEST-row' };
  }, () => undefined, () => { skipped += 1; });
  form.skip();
  form.skip();
  await form.submit();
  expect([saved, skipped]).toEqual([0, 1]);
});

it('navigation back to the same attempt keeps the draft and the pending submit', async () => {
  const { FeedbackFormStore } = await import('../src/features/player/feedbackForm');
  const forms = new FeedbackFormStore();
  let created = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const make = () => {
    created += 1;
    return new FeedbackFormModel({ showId: 'TEST-show', segmentId: 'TEST-segment' }, async () => { await pending; return { mode: 'fake', rowId: 'TEST-row' }; }, () => undefined, () => undefined);
  };
  const first = forms.forAttempt('TEST-attempt-1', make);
  first.setRating('愛');
  first.setReason('TEST retained reason');
  const submitting = first.submit();
  const reopened = forms.forAttempt('TEST-attempt-1', make);
  expect(reopened).toBe(first);
  expect(reopened.getState()).toMatchObject({ rating: '愛', reason: 'TEST retained reason', busy: true });
  expect(forms.forAttempt('TEST-attempt-2', make).getState().rating).toBeNull();
  expect(created).toBe(2);
  release();
  await submitting;
});

it('同一張回饋卡重試沿用 key，重新填寫或換曲目才建立新意圖', async () => {
  const requests: FeedbackRequest[] = [];
  const create = (segmentId: string) => new FeedbackFormModel({ showId: 'TEST-show', segmentId }, async (request) => {
    requests.push(request);
    throw new Error('TEST lost response');
  }, () => undefined, () => undefined);
  const form = create('TEST-segment');
  form.setRating('愛');
  form.setReason('TEST reason');
  await form.submit();
  await form.submit();
  expect(requests[0]?.clientRequestId).toEqual(expect.stringMatching(/^[A-Za-z0-9_-]{8,100}$/));
  expect(requests[1]?.clientRequestId).toBe(requests[0]?.clientRequestId);
  form.setReason('TEST new reason');
  await form.submit();
  expect(requests[2]?.clientRequestId).not.toBe(requests[0]?.clientRequestId);
  form.setRating('不對');
  await form.submit();
  expect(requests[3]?.clientRequestId).not.toBe(requests[2]?.clientRequestId);
  const next = create('TEST-next');
  next.setRating('愛');
  await next.submit();
  expect(requests[4]?.clientRequestId).not.toBe(requests[3]?.clientRequestId);
});
