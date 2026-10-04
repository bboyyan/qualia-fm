import { expect, it } from 'vitest';
import { CONFIRMED_SEED, PlanDraftSchema } from '@qualia/contracts';
import { MockEditorialPlanner } from '../src/providers/mockPlanner.js';
import { toEditorialInput } from '../src/services/editorialInput.js';

it('V5 mock never invents seed texture or taste and labels every synthetic description TEST', async () => {
  const input = toEditorialInput({ seed: { ...CONFIRMED_SEED }, requestedCount: 5, dj: { enabled: true, length: 'short' }, tuning: null });
  const plan = PlanDraftSchema.parse(await new MockEditorialPlanner().draft(input, { signal: new AbortController().signal, scenario: 'five', attempt: 1 }));
  expect(plan.analysis).toMatchObject({ spatialSignature: null, emotionalVelocity: null, timbralPalette: [], lyricalContext: null });
  for (const candidate of plan.candidates) {
    expect(candidate.seedBridge).toMatch(/^TEST/);
    expect(candidate.djLine).toMatch(/^TEST/);
    expect(candidate.vibe.every((vibe) => vibe.startsWith('TEST'))).toBe(true);
  }
});
