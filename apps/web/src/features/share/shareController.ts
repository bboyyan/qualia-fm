/**
 * 分享頁狀態（BRA-129）：開啟（連結或剛建立）、唯讀內容、繼續旅程／先改一句。
 * 計數（開啟、繼續）是盡力而為：送不出去不影響使用者動作。
 */
import {
  SEED_MAX_GRAPHEMES,
  continuationSeed,
  countGraphemes,
  type CreateShareRequest,
  type PlanRequest,
  type ShareCounts,
  type ShareEventKind,
  type ShareView,
} from '@qualia/contracts';
import { ApiError } from '../../api/client';
import type { Settings } from '../settings/settings';

export interface ShareApi {
  create(request: CreateShareRequest): Promise<ShareView>;
  get(code: string): Promise<ShareView>;
  event(code: string, kind: ShareEventKind): Promise<ShareCounts>;
}

export interface ShareState {
  readonly status: 'closed' | 'loading' | 'ready' | 'missing' | 'error';
  readonly view: ShareView | null;
  /** 「先改一句」展開中。 */
  readonly editing: boolean;
  readonly draft: string;
  readonly problem: string | null;
}

export interface ShareControllerDeps {
  readonly api: ShareApi;
  /** 現有開台流程（generation.start）。 */
  readonly startPlan: (request: PlanRequest) => void | Promise<void>;
  readonly settings: () => Settings;
}

const CLOSED: ShareState = { status: 'closed', view: null, editing: false, draft: '', problem: null };
export const EMPTY_DRAFT_PROBLEM = '先寫下一點想去的方向，或保留原本的五首。';

function draftProblem(draft: string): string | null {
  if (draft.trim().length === 0) return EMPTY_DRAFT_PROBLEM;
  if (countGraphemes(draft) > SEED_MAX_GRAPHEMES) return `請縮短至 ${SEED_MAX_GRAPHEMES} 字以內，輸入已保留。`;
  return null;
}

export class ShareController {
  private state: ShareState = CLOSED;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: ShareControllerDeps) {}

  getState = (): ShareState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** 用內部連結打開：解析短碼並記一次「開啟」。 */
  async openFromLink(code: string): Promise<void> {
    this.set({ ...CLOSED, status: 'loading' });
    try {
      const view = await this.deps.api.get(code);
      this.set({ ...CLOSED, status: 'ready', view });
    } catch (error) {
      this.set({ ...CLOSED, status: error instanceof ApiError && error.status === 404 ? 'missing' : 'error' });
      return;
    }
    await this.count(code, 'opened');
  }

  /** 從精選集（之後由寶石牆接入）建立分享並打開分享頁。 */
  async share(request: CreateShareRequest): Promise<void> {
    this.set({ ...CLOSED, status: 'loading' });
    try {
      this.set({ ...CLOSED, status: 'ready', view: await this.deps.api.create(request) });
    } catch {
      this.set({ ...CLOSED, status: 'error' });
    }
  }

  close(): void {
    this.set(CLOSED);
  }

  startEdit(): void {
    const view = this.state.view;
    if (!view) return;
    this.set({ ...this.state, editing: true, draft: continuationSeed(view.tracks).text, problem: null });
  }

  cancelEdit(): void {
    this.set({ ...this.state, editing: false, draft: '', problem: null });
  }

  setDraft(draft: string): void {
    this.set({ ...this.state, draft, problem: null });
  }

  /** 用五首（或改過的那一句）開下一趟；交給現有開台流程，分享頁關閉。 */
  async continueJourney(): Promise<void> {
    const { view, editing, draft } = this.state;
    if (!view) return;
    const problem = editing ? draftProblem(draft) : null;
    if (problem) {
      this.set({ ...this.state, problem });
      return;
    }
    const seed = continuationSeed(view.tracks);
    const settings = this.deps.settings();
    const request: PlanRequest = {
      seed: editing ? { ...seed, text: draft.trim() } : seed,
      requestedCount: 5,
      dj: { enabled: settings.djEnabled, length: settings.djLength },
      tuning: null,
    };
    this.set(CLOSED);
    void this.deps.startPlan(request);
    await this.count(view.code, 'continued');
  }

  /** 計數只是觀測用：失敗時不打斷使用者（開台已交給 generation，錯誤由它呈現）。 */
  private async count(code: string, kind: ShareEventKind): Promise<void> {
    try { await this.deps.api.event(code, kind); }
    catch { /* best-effort metric; the user-facing action already happened */ }
  }

  private set(next: ShareState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}
