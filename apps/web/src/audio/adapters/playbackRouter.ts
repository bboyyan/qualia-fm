/**
 * 引擎唯一的 MediaAdapter。預設（沒有 Spotify 輸出）時把所有操作原樣交給單一 <audio>，行為與以前相同。
 * E 模式時：介紹語音與 MOCK 測試音仍走 <audio>；Spotify 曲目走 Spotify 輸出（路徑 P 或 C）。
 * 一段接一段，絕不疊（Policy III.7）：
 * - 放歌前先停掉 <audio> 並確認已停；
 * - 介紹前若 Spotify 正在出聲，先暫停並等確認靜音，確認不了就不播介紹（引擎改顯示文字）。
 * 不做 ducking、crossfade 或音量調整。
 */
import { notSupported, type SpotifyOutput } from '../spotify/types';
import type { AdapterEvent, MediaAdapter, ProviderState, StartRequest } from '../types';

const SILENCE_TIMEOUT_MS = 2500;

export class PlaybackRouter implements MediaAdapter {
  private output: SpotifyOutput | null = null;
  private active: 'base' | 'spotify' = 'base';
  private readonly listeners = new Set<(event: AdapterEvent) => void>();
  private readonly detachBase: () => void;
  private detachOutput: (() => void) | null = null;

  constructor(readonly base: MediaAdapter) {
    this.detachBase = base.subscribe((event) => this.emit(event));
  }

  get spotifyOutput(): SpotifyOutput | null {
    return this.output;
  }

  /** 切換 Spotify 輸出（P／C／無）。輸出的生命週期由呼叫端管理，這裡只接上或拔掉事件。 */
  setSpotifyOutput(output: SpotifyOutput | null): void {
    if (this.output === output) return;
    if (this.output && this.active === 'spotify') this.output.stop();
    this.detachOutput?.();
    this.detachOutput = null;
    this.output = output;
    this.active = 'base';
    if (output) this.detachOutput = output.subscribe((event) => this.emit(event));
  }

  start(request: StartRequest): Promise<void> {
    if (request.owner === 'track' && request.segment.track.audioLocator.kind === 'spotify_uri') return this.startSpotify(request);
    const output = this.active === 'spotify' ? this.output : null;
    this.active = 'base';
    if (!output) return this.base.start(request);
    const audible = output.isAudible();
    output.stop();
    if (!audible) return this.base.start(request);
    return output
      .whenSilent(SILENCE_TIMEOUT_MS)
      .then((silent) => (silent ? this.base.start(request) : Promise.reject(notSupported('Spotify 尚未確認靜音，不開始介紹。'))));
  }

  pause(): void {
    this.current().pause();
  }

  resume(attemptId: number): Promise<void> {
    return this.current().resume(attemptId);
  }

  seek(positionMs: number): void {
    this.current().seek(positionMs);
  }

  stop(): void {
    this.base.stop();
    this.output?.stop();
  }

  getState(): ProviderState | null {
    return this.current().getState();
  }

  subscribe(listener: (event: AdapterEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.detachBase();
    this.detachOutput?.();
    this.base.destroy();
    this.output?.destroy();
    this.listeners.clear();
  }

  private startSpotify(request: StartRequest): Promise<void> {
    const output = this.output;
    if (!output) return Promise.reject(notSupported('E 模式未啟用，無法在本站播放 Spotify 曲目。'));
    this.base.stop();
    if (this.base.getState()?.paused === false) return Promise.reject(notSupported('介紹尚未停止，不開始歌曲。'));
    this.active = 'spotify';
    return output.start(request);
  }

  private current(): MediaAdapter {
    return this.active === 'spotify' && this.output ? this.output : this.base;
  }

  private emit(event: AdapterEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
