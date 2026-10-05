/**
 * 「愛」→ 先確認 → 才寫入使用者 Spotify 的 Qualia Loved（L2 寫入動作）。只加不刪、不提供移除。
 * 帳本已在送出回饋時寫好；Loved 失敗只說明原因，不讓旅程卡住。
 */
import type { FeedbackReceipt, LovedResult } from '@qualia/contracts';

export type LoveFlowState =
  | { readonly stage: 'confirm' }
  | { readonly stage: 'adding' }
  | { readonly stage: 'result'; readonly loved: 'added' | 'already'; readonly playlistId: string }
  | { readonly stage: 'result'; readonly loved: 'skipped' }
  | { readonly stage: 'result'; readonly loved: 'failed'; readonly message: string };

const FALLBACK_FAILURE = '暫時沒能加入 Qualia Loved，帳本照常寫入。';

export class LoveFlowModel {
  private state: LoveFlowState = { stage: 'confirm' };
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly receipt: FeedbackReceipt,
    private readonly add: () => Promise<LovedResult>,
  ) {}

  getState = (): LoveFlowState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async confirm(): Promise<void> {
    if (this.state.stage !== 'confirm') return;
    this.update({ stage: 'adding' });
    try {
      const result = await this.add();
      this.update({ stage: 'result', loved: result.status, playlistId: result.playlistId });
    } catch (error: unknown) {
      const message = error instanceof Error && error.message ? error.message : FALLBACK_FAILURE;
      this.update({ stage: 'result', loved: 'failed', message });
    }
  }

  skip(): void {
    if (this.state.stage === 'confirm') this.update({ stage: 'result', loved: 'skipped' });
  }

  private update(state: LoveFlowState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

/** 只保留目前這一次回饋的流程；離開收聽頁再回來仍在。 */
export class LoveFlowStore {
  private current: { key: string; flow: LoveFlowModel } | null = null;
  private readonly listeners = new Set<() => void>();

  begin(key: string, flow: LoveFlowModel): void {
    this.current = { key, flow };
    for (const listener of this.listeners) listener();
  }

  forKey(key: string): LoveFlowModel | null {
    return this.current?.key === key ? this.current.flow : null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}
