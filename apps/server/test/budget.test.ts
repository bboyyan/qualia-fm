import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import { BudgetLedger, taipeiDay } from '../src/budget/ledger.js';

beforeEach(() => { vi.stubGlobal('fetch', () => { throw new Error('禁止真實網路'); }); });
const limits = { dailyUsd: 1, totalUsd: 10, plansPerDay: 20, graphemesPerDay: 4000 };
it('預扣先持久化，成功釋放差額，重啟保留金額與每日計數', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qualia-budget-')), 'ledger.json');
  const ledger = new BudgetLedger(path, limits);
  const reservation = ledger.reserve({ usd: 0.9, plans: 1, graphemes: 80 });
  expect(() => ledger.reserve({ usd: 0.2 })).toThrow(/預算/);
  ledger.commit(reservation, 0.1);
  expect(new BudgetLedger(path, limits).snapshot().totalUsd).toBeCloseTo(0.1);
  expect(ledger.snapshot().days[taipeiDay(Date.now())]).toEqual({ usd: 0.1, plans: 1, graphemes: 80 });
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(JSON.parse(readFileSync(path, 'utf8')).version).toBe(1);
});
it('台北日界線固定為 UTC+8，UTC 午夜不重設當日', () => {
  expect(taipeiDay(Date.parse('2026-10-05T15:59:59Z'))).toBe('2026-10-05');
  expect(taipeiDay(Date.parse('2026-10-05T16:00:00Z'))).toBe('2026-10-06');
  expect(taipeiDay(Date.parse('2026-10-05T00:00:00Z'))).toBe('2026-10-05');
});
it('損毀帳本 fail closed', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qualia-budget-')), 'ledger.json');
  writeFileSync(path, '{broken');
  const ledger = new BudgetLedger(path, limits);
  expect(ledger.reason).toContain('帳本');
  expect(() => ledger.reserve({ usd: 0.1 })).toThrow(/帳本/);
});
it('每日 plan、每日 grapheme 與跨日總預算都會阻擋；失敗預扣重啟後仍保留', () => {
  let now = Date.parse('2026-10-05T15:59:59Z');
  const path = join(mkdtempSync(join(tmpdir(), 'qualia-budget-')), 'ledger.json');
  const ledger = new BudgetLedger(path, { ...limits, totalUsd: 1, plansPerDay: 1, graphemesPerDay: 2 }, () => now);
  const reservation = ledger.reserve({ usd: 0.6, plans: 1, graphemes: 2 });
  ledger.retain(reservation);
  expect(() => ledger.reserve({ usd: 0, plans: 1 })).toThrow(/預算/);
  expect(() => ledger.reserve({ usd: 0, graphemes: 1 })).toThrow(/預算/);
  expect(new BudgetLedger(path, limits).snapshot().totalUsd).toBe(0.6);
  now += 1000;
  expect(() => ledger.reserve({ usd: 0.5 })).toThrow(/預算/);
  ledger.reserve({ usd: 0.4, plans: 1, graphemes: 2 });
  expect(ledger.snapshot().days['2026-10-06']).toEqual({ usd: 0.4, plans: 1, graphemes: 2 });
});
it('結構正確但金額不一致也視為損毀，不能重新取得額度', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qualia-budget-')), 'ledger.json');
  writeFileSync(path, JSON.stringify({ version: 1, totalUsd: 0, days: { '2026-10-05': { usd: 1, plans: 1, graphemes: 1 } } }));
  expect(new BudgetLedger(path, limits).reason).toContain('帳本');
});
it('實際用量超出估算時持久記錄停用狀態，重啟不能解除', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qualia-budget-')), 'ledger.json');
  const ledger = new BudgetLedger(path, limits);
  const reservation = ledger.reserve({ usd: 0.1 });
  expect(() => ledger.commit(reservation, 0.2)).toThrow(/預扣/);
  const restarted = new BudgetLedger(path, limits);
  expect(restarted.reason).toContain('預扣');
  expect(restarted.snapshot().totalUsd).toBe(0.2);
});
