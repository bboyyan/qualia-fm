import { PlanDraftSchema, countGraphemes } from '@qualia/contracts';
import { describe, expect, it } from 'vitest';
import { MockEditorialPlanner } from '../../server/src/providers/mockPlanner';
import { effectiveBridge } from '../src/audio/queue';
import { segment } from './fixtures';

describe('MOCK 自然續播實際選中的介紹（BRA-117）', () => {
  it.each(['standard', 'short'] as const)('R2：%s transition 保留曲名、藝人、理由與聆聽提醒', async (djLength) => {
    const draft = PlanDraftSchema.parse(await new MockEditorialPlanner().draft({
      history: [], seedKind: 'feeling', seedText: '深夜', seedArtist: null,
      tuning: null, djEnabled: true, djLength,
    }, { signal: new AbortController().signal, scenario: 'five', attempt: 1 }));
    const items = draft.candidates.map((candidate, index) => ({
      showId: 'showA', segment: { ...segment('showA', index + 1), candidate },
    }));
    const bridge = effectiveBridge(items[1]!, items[0]!);
    expect(bridge.kind).toBe('transition');
    expect(bridge.djLine).toContain(items[1]!.segment.candidate.title);
    expect(bridge.djLine).toContain(items[1]!.segment.candidate.artist);
    expect(bridge.djLine).toContain('示範');
    expect(bridge.djLine).toContain('聽的時候');
    expect(countGraphemes(bridge.djLine)).toBeLessThanOrEqual(djLength === 'standard' ? 180 : 80);
    if (djLength === 'standard') expect(countGraphemes(bridge.djLine)).toBeGreaterThan(80);
  });
});
