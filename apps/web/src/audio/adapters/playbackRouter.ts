/**
 * 引擎唯一的 MediaAdapter。預設（沒有 Spotify 輸出）時把所有操作原樣交給單一 <audio>，行為與以前相同。
 * E 模式時：介紹語音與 MOCK 測試音仍走 <audio>；Spotify 曲目走 Spotify 輸出（路徑 P 或 C）。
 * 一段接一段，絕不疊（Policy III.7）：
 * - 放歌前先停掉 <audio> 並確認已停；
 * - 介紹前若 Spotify 正在出聲，先暫停並等確認靜音，確認不了就不播介紹（引擎改顯示文字）。
 * - 介紹播放中若 Spotify 輸出遲到回報 started，立刻停掉 Spotify、不把事件交給引擎。
 * 不做 ducking、crossfade 或音量調整。
 */
import { notSupported, type SpotifyOutput, type Timers } from '../spotify/types';
import type { AdapterEvent, MediaAdapter, ProviderState, StartRequest } from '../types';

const SILENCE_TIMEOUT_MS = 2500;
/** <audio> 停止若不是立即生效，最多等這麼久；確認不了就不放歌。 */
const BASE_STOP_TIMEOUT_MS = 1000;
const BASE_STOP_POLL_MS = 50;

const globalTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

export class PlaybackRouter implements MediaAdapter {
  private output: SpotifyOutput | null = null;
  private active: 'base' | 'spotify' = 'base';
  private readonly listeners = new Set<(event: AdapterEvent) => void>();
  private readonly detachBase: () => void;
  private detachOutput: (() => void) | null = null;
  /** 每次 start／stop 加一；等待 <audio> 停止期間若被切段，就不再送 Spotify。 */
  private sequence = 0;

  constructor(
    readonly base: MediaAdapter,
    private readonly timers: Timers = globalTimers,
  ) {
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
    if (output) this.detachOutput = output.subscribe((event) => this.onOutputEvent(output, event));
  }

  start(request: StartRequest): Promise<void> {
    this.sequence += 1;
    if (request.owner === 'track' && request.segment.track.audioLocator.kind === 'spotify_uri') return this.startSpotify(request);
    const output = this.active === 'spotify' ? this.output : null;
    this.active = 'base';
    if (!output) return this.base.start(request);
    const audible = output.isAudible();
    output.stop();
    if (!audible) return this.base.start(request);
    const sequence = this.sequence;
    return output.whenSilent(SILENCE_TIMEOUT_MS).then((silent) => {
      if (sequence !== this.sequence) return Promise.reject(new DOMException('已切到別的段落。', 'AbortError'));
      return silent ? this.base.start(request) : Promise.reject(notSupported('Spotify 尚未確認靜音，不開始介紹。'));
    });
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
    this.sequence += 1;
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
    // 一般情況 <audio> 立即停止：同步送出，保留使用者點擊的手勢（iOS 需要）。
    if (this.baseSilent()) {
      this.active = 'spotify';
      return output.start(request);
    }
    const sequence = this.sequence;
    return this.waitBaseSilent().then((silent) => {
      if (sequence !== this.sequence) return Promise.reject(new DOMException('已切到別的段落。', 'AbortError'));
      if (!silent) return Promise.reject(notSupported('介紹尚未停止，不開始歌曲。'));
      this.active = 'spotify';
      return output.start(request);
    });
  }

  private baseSilent(): boolean {
    return this.base.getState()?.paused !== false;
  }

  private waitBaseSilent(): Promise<boolean> {
    return new Promise((resolve) => {
      let waited = 0;
      const check = (): void => {
        if (this.baseSilent()) return resolve(true);
        if (waited >= BASE_STOP_TIMEOUT_MS) return resolve(false);
        waited += BASE_STOP_POLL_MS;
        this.timers.setTimeout(check, BASE_STOP_POLL_MS);
      };
      check();
    });
  }

  /** 介紹（<audio>）擁有喇叭時，Spotify 不該開始出聲：遲到的 started 一律停掉並吞下。 */
  private onOutputEvent(output: SpotifyOutput, event: AdapterEvent): void {
    if (event.type === 'started' && this.active !== 'spotify') {
      output.stop();
      return;
    }
    this.emit(event);
  }

  private current(): MediaAdapter {
    return this.active === 'spotify' && this.output ? this.output : this.base;
  }

  private emit(event: AdapterEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
