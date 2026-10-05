import { expect, it } from 'vitest';
import { LedgerEntrySchema, TasteEditRequestSchema, trackKeyOf } from '../src/index.js';

const target = { showId: 'TEST-show', segmentId: 'TEST-segment' };

it('手動編輯至少要有 mark 或 rating；短評只能跟評價一起送', () => {
  expect(TasteEditRequestSchema.safeParse({ target, mark: 'blocked' }).success).toBe(true);
  expect(TasteEditRequestSchema.safeParse({ target, mark: null }).success).toBe(true);
  expect(TasteEditRequestSchema.safeParse({ target: { trackKey: 'a — b' }, rating: '愛', note: 'TEST' }).success).toBe(true);
  expect(TasteEditRequestSchema.safeParse({ target }).success).toBe(false);
  expect(TasteEditRequestSchema.safeParse({ target, mark: 'pinned', note: 'TEST' }).success).toBe(false);
  expect(TasteEditRequestSchema.safeParse({ target, mark: 'favorite' }).success).toBe(false);
  expect(TasteEditRequestSchema.safeParse({ target: { title: 'TEST', artist: 'TEST' }, mark: 'blocked' }).success).toBe(false);
});

it('LedgerEntry 依 kind 驗證欄位，拒絕多餘欄位（例如 Spotify URI）', () => {
  const base = { entryId: 'TEST-entry-1', at: '2026-10-05T12:00:00.000Z', trackKey: trackKeyOf('A', 'B'), title: 'B', artist: 'A' };
  expect(LedgerEntrySchema.safeParse({ ...base, kind: 'aired', showId: 'TEST-show' }).success).toBe(true);
  expect(LedgerEntrySchema.safeParse({ ...base, kind: 'mark', mark: 'pinned' }).success).toBe(true);
  expect(LedgerEntrySchema.safeParse({ ...base, kind: 'rating', rating: '還行', note: '' }).success).toBe(true);
  expect(LedgerEntrySchema.safeParse({ ...base, kind: 'rating', rating: 'like', note: '' }).success).toBe(false);
  expect(LedgerEntrySchema.safeParse({ ...base, kind: 'aired', showId: 'TEST-show', uri: 'spotify:track:TEST' }).success).toBe(false);
});
