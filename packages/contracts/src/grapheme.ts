/**
 * Grapheme-cluster counting. Spec limits (Seed ≤ 500, DJ line ≤ 80) are measured in
 * Unicode grapheme clusters, never `string.length` (see handoff contracts/README.md).
 */
const segmenter = new Intl.Segmenter('zh-TW', { granularity: 'grapheme' });

export const SEED_MAX_GRAPHEMES = 500;
/** 標準版（加厚）DJ 引言上限：曲名、藝人、為什麼接這首、聽的時候注意什麼（BRA-117）。 */
export const DJ_LINE_MAX_GRAPHEMES = 180;
/** 短版 DJ 引言上限。 */
export const DJ_SHORT_MAX_GRAPHEMES = 80;
export const TUNING_MAX_GRAPHEMES = 200;
export const ARTIST_MAX_GRAPHEMES = 200;

export function countGraphemes(text: string): number {
  let count = 0;
  for (const _ of segmenter.segment(text)) count += 1;
  return count;
}

export function isWithinGraphemes(text: string, max: number): boolean {
  return countGraphemes(text) <= max;
}
