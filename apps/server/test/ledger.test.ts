import { expect, it } from 'vitest';
import { NotionLedger, type NotionClient } from '../src/ledger/notion.js';

it('V3 maps five ledger columns into a Notion table', async () => {
  const stored: unknown[] = [];
  const client: NotionClient = {
    listChildren: async (id) => ({ results: id === '3ef20e2b5b19815d8ecdeb052f5d164e' ? stored : [] , has_more: false, next_cursor: null }),
    appendChildren: async (_id, children) => {
      stored.push(...children);
      return { results: [{ id: 'TEST-block' }] };
    },
  };
  const ledger = new NotionLedger(client);
  await ledger.append({ date: '2026-10-04T00:00:00.000Z', seed: 'TEST seed', recommendation: 'TEST recommendation', rating: '還行', reason: '' });
  expect(stored).toEqual([{ object: 'block', type: 'table', table: {
    table_width: 5, has_column_header: true, has_row_header: false,
    children: [
      { object: 'block', type: 'table_row', table_row: { cells: ['日期', '種子', '推薦', '評價', '原因'].map((content) => [{ type: 'text', text: { content } }]) } },
      { object: 'block', type: 'table_row', table_row: { cells: ['2026-10-04T00:00:00.000Z', 'TEST seed', 'TEST recommendation', '還行', ''].map((content) => [{ type: 'text', text: { content } }]) } },
    ],
  } }]);
});

it('V3/V6 paginated reader includes history fields but excludes TEST evidence rows', async () => {
  const calls: string[] = [];
  const cellRow = (values: string[]) => ({ type: 'table_row', table_row: { cells: values.map((content) => [{ type: 'text', text: { content } }]) } });
  const ledger = new NotionLedger({
    appendChildren: async () => { throw new Error('TEST read only'); },
    listChildren: async (id, cursor) => {
      calls.push(`${id}:${cursor ?? ''}`);
      if (id === '3ef20e2b5b19815d8ecdeb052f5d164e') return { results: [{ id: 'TEST-table', type: 'table', table: { table_width: 5, has_column_header: true } }], has_more: false, next_cursor: null };
      if (!cursor) return { results: [cellRow(['日期', '種子', '推薦', '評價', '原因'])], has_more: true, next_cursor: 'TEST-page-2' };
      return { results: [
        cellRow(['2026-10-04T00:00:00.000Z', 'fake seed', 'fake recommendation', '不對', 'fake reason']),
        cellRow(['2026-10-04T00:00:00.000Z', 'TEST fake seed', 'TEST fake recommendation', '還行', 'TEST evidence']),
      ], has_more: false, next_cursor: null };
    },
  });
  expect(await ledger.read()).toEqual([{ date: '2026-10-04T00:00:00.000Z', seed: 'fake seed', recommendation: 'fake recommendation', rating: '不對', reason: 'fake reason' }]);
  expect(calls).toContain('TEST-table:TEST-page-2');
});
