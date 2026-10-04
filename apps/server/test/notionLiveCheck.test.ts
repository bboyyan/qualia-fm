import { expect, it } from 'vitest';
import { runNotionLiveCheck } from '../../../scripts/notion-live-check.mjs';
import type { LedgerRow } from '@qualia/contracts';

it('V6 defaults to no write and constructs no client before explicit confirmation', async () => {
  let constructed = 0;
  await runNotionLiveCheck([], () => { constructed += 1; throw new Error('must not construct'); }, () => undefined);
  expect(constructed).toBe(0);
});

it('V6 explicit confirmation writes exactly one fake TEST row and emits a row link', async () => {
  const rows: LedgerRow[] = [];
  const messages: string[] = [];
  await runNotionLiveCheck(['--confirm-write-one-test-row'], () => ({
    read: async () => [],
    append: async (row: LedgerRow) => { rows.push(row); return { mode: 'notion', rowId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }; },
  }), (message: string) => messages.push(message));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ seed: 'TEST fake seed', recommendation: 'TEST fake recommendation', rating: '還行', reason: expect.stringMatching(/^TEST/) });
  expect(messages.join('\n')).toContain('測試列（TEST）');
  expect(messages.join('\n')).toContain('#aaaaaaaabbbbccccddddeeeeeeeeeeee');
});
