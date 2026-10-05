/**
 * 「我的歌」狀態（BRA-135）：清單、單曲動作與展開的帳本紀錄，全部讀寫品味帳本 API（BRA-134）。
 * 不做樂觀更新：伺服器回傳更新後的 TrackMark 才換掉那一列，失敗就原樣保留並回報。
 */
import type { LedgerEntry, TrackMark } from '@qualia/contracts';
import { ApiError, type ApiClient } from '../../api/client';
import { PIN_FULL_MESSAGE, doneMessage, editFor, pinState, type SongAction } from './mySongs';

export type SongsApi = Pick<ApiClient, 'tasteMarks' | 'tasteEdit' | 'tasteHistory'>;

export interface HistoryState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly entries: readonly LedgerEntry[];
}

export interface MySongsState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly songs: readonly TrackMark[];
  /** 正在送出動作的 trackKey（同時只送一個）。 */
  readonly pending: string | null;
  readonly history: Readonly<Record<string, HistoryState>>;
  /** 清單讀到的時間（epoch ms）；「最近」濾鏡以此為準，畫面重繪不會改變結果。 */
  readonly loadedAt: number;
}

export interface ActionOutcome {
  readonly ok: boolean;
  readonly message: string;
}

const LOAD_FAILED = '暫時讀不到我的歌，請稍後再試。';
const EDIT_FAILED = '這次沒有記下，請再試一次。';

const messageOf = (error: unknown, fallback: string): string => (error instanceof ApiError ? error.message : fallback);

export class MySongsModel {
  private state: MySongsState = { status: 'idle', songs: [], pending: null, history: {}, loadedAt: 0 };
  private readonly listeners = new Set<() => void>();
  private loadToken = 0;

  constructor(
    private readonly api: SongsApi,
    private readonly now: () => number = Date.now,
  ) {}

  getState = (): MySongsState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private update(patch: Partial<MySongsState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** 每次進到「我的」都重讀；已有清單時保留畫面，只在背景更新。 */
  async load(): Promise<void> {
    const token = (this.loadToken += 1);
    if (this.state.status !== 'ready') this.update({ status: 'loading' });
    try {
      const songs = await this.api.tasteMarks();
      if (token === this.loadToken) this.update({ status: 'ready', songs, history: {}, loadedAt: this.now() });
    } catch {
      if (token === this.loadToken && this.state.status !== 'ready') this.update({ status: 'error' });
    }
  }

  /** 收藏／釘選／封鎖（on＝套上，false＝取消）。釘選已滿時不送出，直接回提示。 */
  async act(trackKey: string, action: SongAction, on: boolean): Promise<ActionOutcome> {
    const song = this.state.songs.find((item) => item.trackKey === trackKey);
    if (!song) return { ok: false, message: LOAD_FAILED };
    if (this.state.pending) return { ok: false, message: '上一個動作還在送出，請稍候。' };
    if (action === 'pin' && on && pinState(this.state.songs, song) === 'full') return { ok: false, message: PIN_FULL_MESSAGE };
    // 背景重讀若還在路上，它的結果比這次編輯舊：作廢，避免蓋掉剛更新的那一列。
    this.loadToken += 1;
    this.update({ pending: trackKey });
    try {
      const updated = await this.api.tasteEdit({ target: { trackKey }, ...editFor(action, on) });
      this.replace(updated);
      return { ok: true, message: doneMessage(action, on, song.title) };
    } catch (error) {
      this.update({ pending: null });
      // 名額可能被別的分頁用掉：重讀清單讓畫面跟帳本一致。
      if (error instanceof ApiError && error.code === 'PIN_LIMIT_REACHED') void this.load();
      return { ok: false, message: messageOf(error, EDIT_FAILED) };
    }
  }

  /** 展開時讀這首最近幾筆帳本紀錄；讀過且沒變動就不重讀。 */
  async loadHistory(trackKey: string): Promise<void> {
    const current = this.state.history[trackKey];
    if (current && current.status !== 'error') return;
    this.setHistory(trackKey, { status: 'loading', entries: [] });
    try {
      const entries = await this.api.tasteHistory(trackKey);
      this.setHistory(trackKey, { status: 'ready', entries });
    } catch {
      this.setHistory(trackKey, { status: 'error', entries: [] });
    }
  }

  private setHistory(trackKey: string, value: HistoryState): void {
    this.update({ history: { ...this.state.history, [trackKey]: value } });
  }

  /** 換掉更新的那一列，並丟掉它的紀錄快取（下次展開重讀）。 */
  private replace(updated: TrackMark): void {
    const songs = this.state.songs.map((item) => (item.trackKey === updated.trackKey ? updated : item));
    const history = Object.fromEntries(Object.entries(this.state.history).filter(([key]) => key !== updated.trackKey));
    this.update({ songs, pending: null, history });
  }
}
