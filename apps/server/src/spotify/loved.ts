/**
 * 「愛」→ Qualia Loved：先查是否已在歌單（去重），不在才加入；只加不刪。
 * 同一首並行請求共用同一次寫入，避免重複加入。
 */
import type { LovedResult } from '@qualia/contracts';
import type { SpotifyWebApi } from './webApi.js';

export class LovedPlaylist {
  private readonly inflight = new Map<string, Promise<LovedResult>>();

  constructor(
    private readonly api: SpotifyWebApi,
    private readonly playlistId: string,
  ) {}

  add(uri: string): Promise<LovedResult> {
    const existing = this.inflight.get(uri);
    if (existing) return existing;
    const pending = this.addOnce(uri).finally(() => this.inflight.delete(uri));
    this.inflight.set(uri, pending);
    return pending;
  }

  private async addOnce(uri: string): Promise<LovedResult> {
    if (await this.api.playlistHas(this.playlistId, uri)) return { status: 'already', playlistId: this.playlistId };
    await this.api.addToPlaylist(this.playlistId, uri);
    return { status: 'added', playlistId: this.playlistId };
  }
}
