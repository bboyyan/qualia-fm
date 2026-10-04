import { afterEach, expect, it, vi } from 'vitest';
import { HtmlAudioAdapter } from '../src/audio/adapters/htmlAudioAdapter';
import { makeShow } from './fixtures';

/** 模擬 DOM 音訊邊界，不啟動瀏覽器或播放實際音訊。 */
class FakeAudio {
  preload = '';
  hidden = false;
  dataset = {};
  src = '';
  currentTime = 0;
  readonly seeks: number[] = [];
  readonly handlers = new Map<string, Map<() => void, boolean>>();
  addEventListener(name: string, listener: () => void, options?: { once?: boolean }): void {
    const listeners = this.handlers.get(name) ?? new Map();
    listeners.set(listener, options?.once ?? false);
    this.handlers.set(name, listeners);
  }
  removeEventListener(name: string, listener: () => void): void { this.handlers.get(name)?.delete(listener); }
  metadata(): void {
    for (const [listener, once] of [...(this.handlers.get('loadedmetadata') ?? [])]) {
      if (once) this.removeEventListener('loadedmetadata', listener);
      listener();
      this.seeks.push(this.currentTime);
    }
  }
  pause(): void {}
  play(): Promise<void> { return Promise.resolve(); }
  load(): void {}
  removeAttribute(): void { this.src = ''; }
  remove(): void {}
}

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const audio = new FakeAudio();
  vi.stubGlobal('document', { createElement: () => audio, body: { appendChild: () => undefined } });
  const adapter = new HtmlAudioAdapter(() => '/TEST-tone.wav');
  const segment = makeShow().segments[0]!;
  return { audio, adapter, segment };
}

it('替換兩次 load 清除舊 metadata 回呼，僅新 attempt 跳轉且觸發後無殘留', async () => {
  const { audio, adapter, segment } = setup();
  await adapter.start({ segment, owner: 'track', attemptId: 1, fromMs: 12_000 });
  await adapter.start({ segment, owner: 'track', attemptId: 2, fromMs: 24_000 });
  expect(audio.handlers.get('loadedmetadata')?.size).toBe(1);
  audio.metadata();
  expect(audio.seeks).toEqual([24]);
  expect(audio.handlers.get('loadedmetadata')?.size).toBe(0);
  audio.metadata();
  expect(audio.seeks).toEqual([24]);
  adapter.destroy();
});

it.each(['replace-zero', 'stop', 'destroy'] as const)('%s 也清除尚未觸發的 metadata listener', async (action) => {
  const { audio, adapter, segment } = setup();
  await adapter.start({ segment, owner: 'track', attemptId: 1, fromMs: 12_000 });
  if (action === 'replace-zero') await adapter.start({ segment, owner: 'track', attemptId: 2, fromMs: 0 });
  if (action === 'stop') adapter.stop();
  if (action === 'destroy') adapter.destroy();
  expect(audio.handlers.get('loadedmetadata')?.size).toBe(0);
  audio.metadata();
  expect(audio.seeks).toEqual([]);
  adapter.destroy();
});
