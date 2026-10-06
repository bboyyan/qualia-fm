import { describe, expect, it, vi } from 'vitest';
import { gemWallOf, type ChooseGemRequest, type ChooseGemResponse, type Gem } from '@qualia/contracts';
import { ApiError } from '../src/api/client';
import { initialEngineState, reduce } from '../src/audio/reducer';
import type { EngineState } from '../src/audio/types';
import { allRevealed, canChoose, chooseCard, createSettlement, revealCard, settlementCards, type Settlement } from '../src/features/gems/settlement';
import { GemSettleController, type SettleApi } from '../src/features/gems/settleController';
import { makeShow } from './fixtures';

const loaded = (sessionId = 'ss_test_1', count = 5): EngineState =>
  reduce({ ...initialEngineState(true, true), feedbackEnabled: true }, { type: 'LOAD_SHOW', show: makeShow(`show-${sessionId}`, count), sessionId }).state;

/** 前 played 首播完、其餘略過，節目結束。 */
function completed(state: EngineState, played = state.queue.length): EngineState {
  const statuses = Object.fromEntries(state.queue.map((item, i) => [item.segment.segmentId, i < played ? 'played' : 'skipped'] as const));
  return { ...state, statuses, phase: 'completed' };
}

const revealAll = (settlement: Settlement): Settlement => settlement.cards.reduce((s, card) => revealCard(s, card.segmentId), settlement);

function gem(n: number, journeyId = `ss_test_${n}`): Gem {
  return { gemId: `gem_test_${String(n).padStart(4, '0')}`, journeyId, trackKey: `k${n}`, title: `曲目${n}`, artist: 'a', palette: n % 8, chosenAt: '2026-10-06T00:00:00.000Z' };
}

describe('BRA-169 V2：結算翻牌（純函式）', () => {
  it('牌堆＝這趟播完的曲目，背面朝上；帶聲景色號', () => {
    const settlement = createSettlement('ss_test_1', settlementCards(completed(loaded()), {}));
    expect(settlement.cards.map((card) => [card.title, card.revealed, card.palette])).toEqual([
      ['曲目1', false, 1], ['曲目2', false, 2], ['曲目3', false, 3], ['曲目4', false, 4], ['曲目5', false, 5],
    ]);
  });

  it('被按「不對」的歌不進牌堆；沒播完的不進牌堆', () => {
    const state = completed(loaded(), 4);
    const cards = settlementCards(state, { [state.queue[1]!.segment.segmentId]: '不對' });
    expect(cards.map((card) => card.title)).toEqual(['曲目1', '曲目3', '曲目4']);
  });

  it('五首未全揭開不可選：翻了四張仍不能選，選了也不生效', () => {
    let settlement = createSettlement('ss_test_1', settlementCards(completed(loaded()), {}));
    for (const card of settlement.cards.slice(0, 4)) settlement = revealCard(settlement, card.segmentId);
    expect(allRevealed(settlement)).toBe(false);
    expect(canChoose(settlement)).toBe(false);
    expect(chooseCard(settlement, settlement.cards[0]!.segmentId)).toBe(settlement);
    expect(chooseCard(settlement, settlement.cards[0]!.segmentId).picked).toBeNull();
  });

  it('全部揭開後才可選 1 首；不在牌堆的段落不能選', () => {
    const settlement = revealAll(createSettlement('ss_test_1', settlementCards(completed(loaded()), {})));
    expect(canChoose(settlement)).toBe(true);
    expect(chooseCard(settlement, 'nope')).toBe(settlement);
    expect(chooseCard(settlement, settlement.cards[2]!.segmentId).picked).toBe(settlement.cards[2]!.segmentId);
  });

  it('翻牌冪等，不可蓋回去', () => {
    const settlement = createSettlement('ss_test_1', settlementCards(completed(loaded()), {}));
    const once = revealCard(settlement, settlement.cards[0]!.segmentId);
    expect(revealCard(once, settlement.cards[0]!.segmentId)).toBe(once);
  });

  it('0 張牌（都沒聽完）永遠不可選', () => {
    const settlement = createSettlement('ss_test_1', []);
    expect(allRevealed(settlement)).toBe(false);
    expect(canChoose(settlement)).toBe(false);
  });
});

function fakeApi(response?: (request: ChooseGemRequest) => ChooseGemResponse): SettleApi & { calls: ChooseGemRequest[] } {
  const calls: ChooseGemRequest[] = [];
  return {
    calls,
    chooseGem: async (request) => {
      calls.push(request);
      if (!response) throw new ApiError({ code: 'INTERNAL', message: '這顆寶石沒有收進寶石牆，請再試一次。', retryable: true, requestId: 'r', retryAfterMs: null }, 500);
      return response(request);
    },
  };
}

const respond = (gems: Gem[]) => (request: ChooseGemRequest): ChooseGemResponse => {
  const chosen: Gem = { ...gem(gems.length + 1, request.journeyId), title: '曲目3', palette: request.palette };
  const all = [...gems, chosen];
  const wall = gemWallOf(all);
  return { gem: chosen, wall, unlocked: all.length % 5 === 0 ? (wall.selections.at(-1) ?? null) : null };
};

describe('GemSettleController：接播放引擎與 API', () => {
  it('節目播完才開結算；同一趟只開一次', () => {
    const controller = new GemSettleController(fakeApi());
    const state = loaded();
    controller.observe(state);
    expect(controller.getState().settlement).toBeNull();
    controller.observe(completed(state));
    const first = controller.getState().settlement;
    expect(first?.journeyId).toBe('ss_test_1');
    expect(controller.getState().open).toBe(true);
    controller.observe(completed(state));
    expect(controller.getState().settlement).toBe(first);
  });

  it('回饋「不對」記在這趟，結算時不進牌堆', () => {
    const controller = new GemSettleController(fakeApi());
    const state = loaded();
    controller.recordRating('ss_test_1', state.queue[0]!.segment.segmentId, '不對');
    controller.observe(completed(state));
    expect(controller.getState().settlement?.cards.map((card) => card.title)).toEqual(['曲目2', '曲目3', '曲目4', '曲目5']);
  });

  it('未全揭開時 confirm 不送出；全開＋選定後送出段落識別與色號', async () => {
    const api = fakeApi(respond([]));
    const onChosen = vi.fn();
    const controller = new GemSettleController(api, onChosen);
    controller.observe(completed(loaded()));
    const cards = controller.getState().settlement!.cards;
    controller.reveal(cards[0]!.segmentId);
    controller.pick(cards[2]!.segmentId);
    await controller.confirm();
    expect(api.calls).toEqual([]);
    for (const card of cards) controller.reveal(card.segmentId);
    controller.pick(cards[2]!.segmentId);
    await controller.confirm();
    expect(api.calls).toEqual([{ journeyId: 'ss_test_1', showId: 'show-ss_test_1', segmentId: cards[2]!.segmentId, palette: 3 }]);
    expect(controller.getState().result?.gem.title).toBe('曲目3');
    expect(onChosen).toHaveBeenCalledWith(controller.getState().result);
    // 選完不能再選第二首（同趟不重複）。
    controller.pick(cards[0]!.segmentId);
    await controller.confirm();
    expect(api.calls).toHaveLength(1);
  });

  it('第 5 顆：結果帶出解鎖的精選集', async () => {
    const controller = new GemSettleController(fakeApi(respond([gem(1), gem(2), gem(3), gem(4)])));
    controller.observe(completed(loaded()));
    const cards = controller.getState().settlement!.cards;
    for (const card of cards) controller.reveal(card.segmentId);
    controller.pick(cards[2]!.segmentId);
    await controller.confirm();
    expect(controller.getState().result?.unlocked?.no).toBe(1);
  });

  it('送出失敗：保留選擇與錯誤訊息，可重試', async () => {
    const controller = new GemSettleController(fakeApi());
    controller.observe(completed(loaded()));
    const cards = controller.getState().settlement!.cards;
    for (const card of cards) controller.reveal(card.segmentId);
    controller.pick(cards[1]!.segmentId);
    await controller.confirm();
    expect(controller.getState()).toMatchObject({ status: 'error', error: '這顆寶石沒有收進寶石牆，請再試一次。', result: null });
    expect(controller.getState().settlement?.picked).toBe(cards[1]!.segmentId);
  });

  it('關掉結算層不會遺失翻牌進度，可再打開', () => {
    const controller = new GemSettleController(fakeApi());
    controller.observe(completed(loaded()));
    const card = controller.getState().settlement!.cards[0]!;
    controller.reveal(card.segmentId);
    controller.close();
    expect(controller.getState().open).toBe(false);
    controller.reopen();
    expect(controller.getState().open).toBe(true);
    expect(controller.getState().settlement?.cards[0]?.revealed).toBe(true);
  });

  it('新的一趟換新牌堆', () => {
    const controller = new GemSettleController(fakeApi());
    controller.observe(completed(loaded('ss_test_1')));
    controller.observe(loaded('ss_test_2'));
    expect(controller.getState().settlement).toBeNull();
    controller.observe(completed(loaded('ss_test_2')));
    expect(controller.getState().settlement?.journeyId).toBe('ss_test_2');
  });
});
