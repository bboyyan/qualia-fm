import { expect, it } from 'vitest';
import { FeedbackRatingSchema } from '../src/index.js';

it('V2 accepts only 愛／還行／不對', () => {
  for (const value of ['愛', '還行', '不對']) expect(FeedbackRatingSchema.parse(value)).toBe(value);
  for (const value of ['like', '', null, 1, '愛 ']) expect(FeedbackRatingSchema.safeParse(value).success).toBe(false);
});
