import { describe, expect, it } from 'vitest';
import type { LovedResult } from '@qualia/contracts';
import { LoveFlowModel, LoveFlowStore } from '../src/features/player/loveFlow';
import { localError } from '../src/api/client';

const receipt = { mode: 'fake' as const, rowId: 'TEST-1' };
const added: LovedResult = { status: 'added', playlistId: '0dF9anAJZv0IotD6lo2kl2' };

describe('「愛」→ 確認 → 加入 Qualia Loved', () => {
  it('先停在確認，按「加入」才呼叫伺服器；只呼叫一次', async () => {
    const calls: number[] = [];
    const flow = new LoveFlowModel(receipt, () => (calls.push(1), Promise.resolve(added)));
    expect(flow.getState()).toEqual({ stage: 'confirm' });
    expect(calls).toEqual([]);
    const first = flow.confirm();
    void flow.confirm();
    expect(flow.getState()).toEqual({ stage: 'adding' });
    await first;
    expect(calls).toEqual([1]);
    expect(flow.getState()).toEqual({ stage: 'result', loved: 'added', playlistId: '0dF9anAJZv0IotD6lo2kl2' });
  });

  it('已在歌單 → already；選「只記帳本」→ skipped 且不呼叫', async () => {
    const already = new LoveFlowModel(receipt, () => Promise.resolve({ ...added, status: 'already' }));
    await already.confirm();
    expect(already.getState()).toMatchObject({ stage: 'result', loved: 'already' });
    let called = false;
    const skip = new LoveFlowModel(receipt, () => ((called = true), Promise.resolve(added)));
    skip.skip();
    expect(skip.getState()).toEqual({ stage: 'result', loved: 'skipped' });
    await skip.confirm();
    expect(called).toBe(false);
  });

  it('加入失敗 → 說明原因，旅程不卡住（帳本已寫入）', async () => {
    const flow = new LoveFlowModel(receipt, () => Promise.reject(localError('SPOTIFY_NOT_ALLOWLISTED', 'TEST 拒絕')));
    await flow.confirm();
    expect(flow.getState()).toEqual({ stage: 'result', loved: 'failed', message: 'TEST 拒絕' });
    expect(flow.receipt).toEqual(receipt);
  });

  it('同一個回饋步驟只保留一個流程（切換頁面回來仍在）', () => {
    const store = new LoveFlowStore();
    const flow = new LoveFlowModel(receipt, () => Promise.resolve(added));
    store.begin('a', flow);
    expect(store.forKey('a')).toBe(flow);
    expect(store.forKey('b')).toBeNull();
  });
});
