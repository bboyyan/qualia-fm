import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { gemWallOf, type Gem, type GemWall } from '@qualia/contracts';
import { ApiError } from '../src/api/client';
import { GemWallModel } from '../src/features/gems/gemWallModel';
import { dateLabel, entryLine, progressLine } from '../src/features/gems/gemCopy';
import { GemWallView } from '../src/features/gems/GemWallPage';
import { SettlePanel } from '../src/features/gems/SettleOverlay';
import { createSettlement, revealCard, type SettleCard } from '../src/features/gems/settlement';
import type { SettleState } from '../src/features/gems/settleController';

function gem(n: number): Gem {
  return { gemId: `gem_test_${String(n).padStart(4, '0')}`, journeyId: `ss_test_${n}`, trackKey: `k${n}`, title: `曲目${n}`, artist: `藝人${n}`, palette: n % 8, chosenAt: '2026-10-05T16:30:00.000Z' };
}
const wallOf = (count: number): GemWall => gemWallOf(Array.from({ length: count }, (_, i) => gem(i + 1)));

describe('寶石牆文案', () => {
  it('空牆：開第一趟，留下第一顆寶石', () => {
    expect(progressLine(wallOf(0))).toBe('開第一趟，留下第一顆寶石。');
    expect(entryLine(wallOf(0))).toBe('開第一趟，留下第一顆寶石');
  });

  it('進行中：再 N 趟開出第 M 本', () => {
    expect(progressLine(wallOf(3))).toBe('再 2 趟，就能開出第 1 本旅程精選集。');
    expect(entryLine(wallOf(8))).toBe('再開 2 趟，串成第 2 本旅程精選集');
  });

  it('剛滿一本：下一本從 0/5 開始', () => {
    expect(progressLine(wallOf(5))).toBe('第 1 本已收進書架。再 5 趟，開出第 2 本。');
  });

  it('日期以台北時間 MM/DD 顯示', () => {
    expect(dateLabel('2026-10-05T16:30:00.000Z')).toBe('10/06');
  });
});

describe('GemWallModel', () => {
  it('讀取成功 → ready；apply 直接換成選完後的牆', async () => {
    const model = new GemWallModel({ gemWall: async () => wallOf(2) });
    await model.load();
    expect(model.getState()).toMatchObject({ status: 'ready', wall: { total: 2 }, error: null });
    model.apply(wallOf(3));
    expect(model.getState().wall?.total).toBe(3);
  });

  it('讀取失敗：明示錯誤；已有資料時保留舊牆', async () => {
    let fail = false;
    const model = new GemWallModel({
      gemWall: async () => {
        if (fail) throw new ApiError({ code: 'INTERNAL', message: '寶石牆暫時讀不到', retryable: true, requestId: 'r', retryAfterMs: null }, 500);
        return wallOf(1);
      },
    });
    await model.load();
    fail = true;
    await model.load();
    expect(model.getState()).toMatchObject({ status: 'ready', wall: { total: 1 }, error: '寶石牆暫時讀不到' });
    const fresh = new GemWallModel({ gemWall: async () => { throw new Error('offline'); } });
    await fresh.load();
    expect(fresh.getState()).toMatchObject({ status: 'error', wall: null, error: '暫時讀不到寶石牆，請稍後再試。' });
  });
});

describe('寶石牆畫面（靜態標記）', () => {
  it('顯示進度、收藏數與這本的寶石；已解鎖精選集列在書架', () => {
    const html = renderToStaticMarkup(createElement(GemWallView, { wall: wallOf(7), onStart: () => undefined }));
    expect(html).toContain('data-testid="gem-wall-progress"');
    expect(html).toContain('2 / 5');
    expect(html).toContain('已收寶石');
    expect(html).toContain('>7<');
    expect(html).toContain('曲目6');
    expect(html).toContain('旅程精選集 No.01');
    expect(html).toContain('第 6 趟');
  });

  it('空牆：0/5＋去開台', () => {
    const html = renderToStaticMarkup(createElement(GemWallView, { wall: wallOf(0), onStart: () => undefined }));
    expect(html).toContain('0 / 5');
    expect(html).toContain('開第一趟，留下第一顆寶石。');
    expect(html).toContain('去開台');
  });
});

describe('結算層（靜態標記）', () => {
  const cards: SettleCard[] = [1, 2, 3, 4, 5].map((n) => ({ segmentId: `s${n}`, showId: 'show', title: `曲目${n}`, artist: 'a', palette: n, revealed: false }));
  const base: SettleState = { settlement: createSettlement('ss_test_1', cards), open: true, status: 'idle', result: null, error: null };
  const noop = { onReveal: () => undefined, onPick: () => undefined, onConfirm: () => undefined, onWall: () => undefined, onCapsule: () => undefined, capsule: null };

  it('五張背面牌：曲名不外露，確認鈕停用並說明還有幾張', () => {
    const html = renderToStaticMarkup(createElement(SettlePanel, { state: base, ...noop }));
    expect(html.match(/data-card-state="hidden"/g)).toHaveLength(5);
    expect(html).not.toContain('曲目1');
    expect(html).toContain('還有 5 張沒翻開');
    expect(html).toMatch(/data-testid="settle-confirm"[^>]*disabled/);
  });

  it('沒有牌：說明聽完一首才會留下寶石', () => {
    const html = renderToStaticMarkup(createElement(SettlePanel, { state: { ...base, settlement: createSettlement('ss_test_1', []) }, ...noop }));
    expect(html).toContain('聽完一首才會留下寶石');
    expect(html).not.toContain('settle-confirm');
  });

  it('全部翻開：曲名出現，可以選', () => {
    const settlement = cards.reduce((s, card) => revealCard(s, card.segmentId), base.settlement!);
    const html = renderToStaticMarkup(createElement(SettlePanel, { state: { ...base, settlement }, ...noop }));
    expect(html).toContain('曲目3');
    expect(html.match(/data-card-state="revealed"/g)).toHaveLength(5);
    expect(html).toContain('選一首留成寶石');
  });
});
