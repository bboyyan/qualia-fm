import { FeedbackRequestSchema, type FeedbackRequest, type FeedbackReceipt } from '@qualia/contracts';

type Rating = FeedbackRequest['rating'];
export interface FeedbackFormState {
  rating: Rating | null;
  reason: string;
  busy: boolean;
  finished: boolean;
  error: string | null;
}

/** One form per playback attempt. A pending save cannot be submitted or skipped twice. */
export class FeedbackFormModel {
  private clientRequestId: string | undefined;
  private state: FeedbackFormState = { rating: null, reason: '', busy: false, finished: false, error: null };
  private readonly listeners = new Set<() => void>();
  constructor(
    private readonly target: Pick<FeedbackRequest, 'showId' | 'segmentId'>,
    private readonly save: (request: FeedbackRequest) => Promise<FeedbackReceipt>,
    private readonly onSaved: (receipt: FeedbackReceipt) => void,
    private readonly onSkipped: () => void,
  ) {}
  getState = (): FeedbackFormState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(patch: Partial<FeedbackFormState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  setRating(rating: Rating): void {
    if (!this.state.busy && !this.state.finished) {
      if (rating !== this.state.rating) this.clientRequestId = undefined;
      this.update({ rating, error: null });
    }
  }
  setReason(reason: string): void {
    if (!this.state.busy && !this.state.finished) {
      if (reason !== this.state.reason) this.clientRequestId = undefined;
      this.update({ reason, error: null });
    }
  }
  skip(): void {
    if (this.state.busy || this.state.finished) return;
    this.update({ finished: true });
    this.onSkipped();
  }
  async submit(): Promise<void> {
    if (this.state.busy || this.state.finished) return;
    const parsed = FeedbackRequestSchema.safeParse({ ...this.target, rating: this.state.rating, reason: this.state.reason });
    if (!parsed.success) {
      this.update({ error: this.state.rating === null ? '請選愛、還行或不對。' : '原因請縮短至 200 字以內。' });
      return;
    }
    // 一次提交意圖只建立一次 key；失敗後原樣重試沿用。
    this.clientRequestId ??= crypto.randomUUID();
    this.update({ busy: true, error: null });
    let receipt: FeedbackReceipt;
    try {
      receipt = await this.save({ ...parsed.data, clientRequestId: this.clientRequestId });
    } catch {
      this.update({ busy: false, error: '未能記錄回饋，內容已保留。請重試或略過回饋。' });
      return;
    }
    this.update({ busy: false, finished: true });
    this.onSaved(receipt);
  }
}

/** Keeps only the current attempt in memory, including while its view is unmounted. */
export class FeedbackFormStore {
  private current: { key: string; model: FeedbackFormModel } | null = null;
  forAttempt(key: string, create: () => FeedbackFormModel): FeedbackFormModel {
    if (this.current?.key !== key) this.current = { key, model: create() };
    return this.current.model;
  }
}
