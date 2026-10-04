import { z } from 'zod';
import { LedgerRowSchema, type LedgerRow, type FeedbackReceipt } from '@qualia/contracts';
import type { FeedbackLedger } from './types.js';

export const LEDGER_PAGE_ID = '3ef20e2b5b19815d8ecdeb052f5d164e';
export const LEDGER_COLUMNS = ['日期', '種子', '推薦', '評價', '原因'] as const;
export interface NotionClient {
  listChildren(id: string, cursor?: string, signal?: AbortSignal): Promise<{ results: unknown[]; has_more: boolean; next_cursor: string | null }>;
  appendChildren(id: string, children: unknown[]): Promise<{ results: { id: string }[] }>;
}
const richText = z.array(z.object({ type: z.literal('text'), text: z.object({ content: z.string() }) }));
const tableRow = z.object({ type: z.literal('table_row'), table_row: z.object({ cells: z.array(richText).length(5) }) });
const table = z.object({ id: z.string(), type: z.literal('table'), table: z.object({ table_width: z.literal(5), has_column_header: z.literal(true) }) });
const textRow = (values: readonly string[]) => ({ object: 'block', type: 'table_row', table_row: { cells: values.map((content) => [{ type: 'text', text: { content } }]) } });

/** Page blocks only: each append adds one header + one data row table to the fixed page.
 * No database, arbitrary page IDs, recursive child-page traversal or HTML input.
 */
export class NotionLedger implements FeedbackLedger {
  constructor(private readonly client: NotionClient) {}
  async append(input: LedgerRow): Promise<FeedbackReceipt> {
    const row = LedgerRowSchema.parse(input);
    const result = await this.client.appendChildren(LEDGER_PAGE_ID, [{ object: 'block', type: 'table', table: {
      table_width: 5, has_column_header: true, has_row_header: false,
      children: [textRow(LEDGER_COLUMNS), textRow([row.date, row.seed, row.recommendation, row.rating, row.reason])],
    } }]);
    if (!result.results[0]?.id) throw new Error('ledger write response invalid');
    return { mode: 'notion', rowId: result.results[0].id };
  }
  private async children(id: string, signal?: AbortSignal): Promise<unknown[]> {
    const result: unknown[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.client.listChildren(id, cursor, signal);
      result.push(...page.results);
      if (page.has_more && (!page.next_cursor || page.next_cursor === cursor)) throw new Error('ledger pagination invalid');
      cursor = page.has_more ? page.next_cursor ?? undefined : undefined;
    } while (cursor);
    return result;
  }
  async read(signal?: AbortSignal): Promise<LedgerRow[]> {
    const rows: LedgerRow[] = [];
    for (const block of await this.children(LEDGER_PAGE_ID, signal)) {
      const parsed = table.safeParse(block);
      if (!parsed.success) continue;
      const children = await this.children(parsed.data.id, signal);
      const cells = children.map((child) => tableRow.parse(child).table_row.cells.map((cell) => cell.map((text) => text.text.content).join('')));
      if (JSON.stringify(cells[0]) !== JSON.stringify(LEDGER_COLUMNS)) continue;
      for (const values of cells.slice(1)) {
        const [date, seed, recommendation, rating, reason] = values;
        // TEST rows are evidence, never real preference input.
        if (date?.startsWith('TEST') || seed?.startsWith('TEST') || reason?.startsWith('TEST')) continue;
        rows.push(LedgerRowSchema.parse({ date, seed, recommendation, rating, reason }));
      }
    }
    return rows;
  }
}

/** Not constructed by createApp: only explicit injection or the opt-in live check.
 * Token is read only from the environment at construction, never accepted as a parameter.
 */
export function createNotionHttpClient(): NotionClient {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error('NOTION_TOKEN required');
  async function request(path: string, method: string, body?: unknown, signal?: AbortSignal) {
    const response = await fetch(`https://api.notion.com/v1/blocks/${path}`, {
      method, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
      headers: { Authorization: ['Bearer', token].join(' '), 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Notion ledger HTTP ${response.status}`);
    return response.json();
  }
  return {
    listChildren: async (id, cursor, signal) => z.object({ results: z.array(z.unknown()), has_more: z.boolean(), next_cursor: z.string().nullable() }).parse(await request(`${encodeURIComponent(id)}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`, 'GET', undefined, signal)),
    appendChildren: async (id, children) => z.object({ results: z.array(z.object({ id: z.string() })) }).parse(await request(`${encodeURIComponent(id)}/children`, 'PATCH', { children })),
  };
}
