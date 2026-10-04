import { expect, it } from 'vitest';
import { FeedbackRatingSchema, FeedbackRequestSchema } from '../src/index.js';

it('V2 accepts only 愛／還行／不對', () => {
  for (const value of ['愛', '還行', '不對']) expect(FeedbackRatingSchema.parse(value)).toBe(value);
  for (const value of ['like', '', null, 1, '愛 ']) expect(FeedbackRatingSchema.safeParse(value).success).toBe(false);
});

it('回饋接受可選 clientRequestId，拒絕空白或過長的 key', () => {
  const body = { showId: 'TEST-show', segmentId: 'TEST-segment', rating: '愛', reason: '' };
  expect(FeedbackRequestSchema.parse(body)).toEqual(body);
  expect(FeedbackRequestSchema.parse({ ...body, clientRequestId: 'TEST-intent' }).clientRequestId).toBe('TEST-intent');
  for (const clientRequestId of ['', ' '.repeat(8), 'a'.repeat(101)]) {
    expect(FeedbackRequestSchema.safeParse({ ...body, clientRequestId }).success).toBe(false);
  }
});
