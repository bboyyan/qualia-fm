/**
 * 寶石牆狀態（BRA-169）：讀 GET /api/gems；結算選完由 apply 直接換成伺服器回傳的新牆，不做樂觀更新。
 * 重讀失敗時保留上次讀到的牆並明示錯誤。
 */
import type { GemWall } from '@qualia/contracts';
import { ApiError, type ApiClient } from '../../api/client';

export type GemWallApi = Pick<ApiClient, 'gemWall'>;

export interface GemWallState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly wall: GemWall | null;
  readonly error: string | null;
}

const LOAD_FAILED = '暫時讀不到寶石牆，請稍後再試。';

export class GemWallModel {
  private state: GemWallState = { status: 'idle', wall: null, error: null };
  private readonly listeners = new Set<() => void>();
  private loadToken = 0;

  constructor(private readonly api: GemWallApi) {}

  getState = (): GemWallState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async load(): Promise<void> {
    const token = (this.loadToken += 1);
    if (!this.state.wall) this.update({ status: 'loading' });
    try {
      const wall = await this.api.gemWall();
      if (token === this.loadToken) this.update({ status: 'ready', wall, error: null });
    } catch (error) {
      if (token !== this.loadToken) return;
      const message = error instanceof ApiError ? error.message : LOAD_FAILED;
      this.update({ status: this.state.wall ? 'ready' : 'error', error: message });
    }
  }

  /** 選完寶石：伺服器回傳的牆比任何還在路上的重讀都新。 */
  apply(wall: GemWall): void {
    this.loadToken += 1;
    this.update({ status: 'ready', wall, error: null });
  }

  private update(patch: Partial<GemWallState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
