/**
 * Licensed/mock adapter: ONE long-lived HTMLAudioElement switched between speech and track,
 * so two sources can never be audible at once (docs/06 Licensed adapter). Events are tagged
 * with the attemptId that started them; pause events during a source switch are ignored.
 */
import type { Segment } from '@qualia/contracts';
import { synthesizeChime, synthesizePad } from '../tone';
import type { AdapterEvent, MediaAdapter, OwnerKind, ProviderState, StartRequest } from '../types';

/** Returns a playable URL for the owner, or throws when the segment has no permitted source. */
export type SourceResolver = (owner: OwnerKind, segment: Segment) => string;

interface Current {
  readonly attemptId: number;
  readonly owner: OwnerKind;
}

export class HtmlAudioAdapter implements MediaAdapter {
  private readonly audio: HTMLAudioElement;
  private readonly listeners = new Set<(event: AdapterEvent) => void>();
  private current: Current | null = null;
  private playingAttempt: number | null = null;
  private blockNextPlay = false;
  private lost = false;
  private readonly detach: () => void;

  constructor(private readonly resolveSource: SourceResolver) {
    this.audio = document.createElement('audio');
    this.audio.preload = 'auto';
    this.audio.hidden = true;
    this.audio.dataset.qfmAudio = 'single-owner';
    document.body.appendChild(this.audio);
    this.detach = this.listen();
  }

  start(request: StartRequest): Promise<void> {
    this.current = { attemptId: request.attemptId, owner: request.owner };
    this.playingAttempt = null;
    this.audio.pause();
    let url: string;
    try {
      url = this.resolveSource(request.owner, request.segment);
    } catch {
      return Promise.reject(new DOMException('No permitted audio source for this segment.', 'NotSupportedError'));
    }
    this.audio.src = url;
    if (request.fromMs > 0) {
      this.audio.addEventListener('loadedmetadata', () => (this.audio.currentTime = request.fromMs / 1000), { once: true });
    }
    return this.playGuarded();
  }

  pause(): void {
    this.audio.pause();
  }

  resume(attemptId: number): Promise<void> {
    if (this.current) this.current = { ...this.current, attemptId };
    this.playingAttempt = null;
    return this.playGuarded();
  }

  seek(positionMs: number): void {
    this.audio.currentTime = positionMs / 1000;
  }

  stop(): void {
    this.current = null;
    this.playingAttempt = null;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
  }

  getState(): ProviderState | null {
    if (this.lost) return null;
    const duration = this.audio.duration;
    return {
      positionMs: Math.round(this.audio.currentTime * 1000),
      durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : null,
      paused: this.audio.paused,
      ready: this.audio.readyState >= 1,
    };
  }

  subscribe(listener: (event: AdapterEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.stop();
    this.detach();
    this.audio.remove();
    this.listeners.clear();
  }

  /** MOCK review affordance: the next play() rejects like a mobile autoplay block. */
  simulateAutoplayBlockOnce(): void {
    this.blockNextPlay = true;
  }

  /** MOCK review affordance: the output disappears until `reconnect()`. */
  simulateDeviceLost(): void {
    this.lost = true;
    this.audio.pause();
  }

  reconnect(): void {
    this.lost = false;
  }

  private playGuarded(): Promise<void> {
    if (this.blockNextPlay) {
      this.blockNextPlay = false;
      return Promise.reject(new DOMException('Playback needs a user gesture (MOCK simulation).', 'NotAllowedError'));
    }
    return this.audio.play();
  }

  private emit(event: AdapterEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private listen(): () => void {
    const onPlaying = () => {
      if (!this.current) return;
      this.playingAttempt = this.current.attemptId;
      this.emit({ type: 'started', ...this.current });
    };
    const onPause = () => {
      // Natural end fires pause before ended; source switches pause before the new attempt plays.
      if (!this.current || this.audio.ended || this.playingAttempt !== this.current.attemptId) return;
      this.emit({ type: 'paused', ...this.current, positionMs: Math.round(this.audio.currentTime * 1000) });
    };
    const onEnded = () => {
      if (this.current && this.playingAttempt === this.current.attemptId) this.emit({ type: 'ended', ...this.current });
    };
    const onError = () => {
      if (this.current && this.audio.getAttribute('src')) this.emit({ type: 'failed', ...this.current, code: 'AUDIO_SOURCE_FAILED' });
    };
    const handlers: [string, () => void][] = [
      ['playing', onPlaying],
      ['pause', onPause],
      ['ended', onEnded],
      ['error', onError],
    ];
    for (const [name, fn] of handlers) this.audio.addEventListener(name, fn);
    return () => handlers.forEach(([name, fn]) => this.audio.removeEventListener(name, fn));
  }
}

/** Blob-URL cache so each synthesised tone is generated once per page. */
function cachedUrl(cache: Map<string, string>, key: string, make: () => Uint8Array): string {
  const existing = cache.get(key);
  if (existing) return existing;
  const bytes = make();
  const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' }));
  cache.set(key, url);
  return url;
}

/** MOCK resolver: synthesised test tones only. Never resolves Spotify URIs or remote URLs. */
export function mockSourceResolver(): SourceResolver {
  const cache = new Map<string, string>();
  return (owner, segment) => {
    if (owner === 'speech') {
      if (segment.speech.kind !== 'mock_chime') throw new Error('no speech source');
      const { durationMs } = segment.speech;
      return cachedUrl(cache, `chime:${durationMs}`, () => synthesizeChime(durationMs));
    }
    const locator = segment.track.audioLocator;
    if (locator.kind !== 'mock_tone') throw new Error('mock adapter only plays mock tones');
    return cachedUrl(cache, `pad:${locator.palette}:${locator.durationMs}`, () => synthesizePad(locator.palette, locator.durationMs));
  };
}

/** Licensed resolver boundary: same-origin licensed URLs only (not reachable in this build). */
export function licensedSourceResolver(origin: string): SourceResolver {
  return (owner, segment) => {
    const locator = segment.track.audioLocator;
    if (owner !== 'track' || locator.kind !== 'licensed_url') throw new Error('no licensed source');
    const url = new URL(locator.url, origin);
    if (url.origin !== origin) throw new Error('licensed audio must be same-origin');
    return url.toString();
  };
}
