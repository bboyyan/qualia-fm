/**
 * Spotify adapter BOUNDARY ONLY. G0-A/B/C gates have not passed, so this build never loads the
 * Web Playback SDK, never requests tokens, never fetches, proxies or analyses Spotify audio,
 * and never inserts speech or ducks volume. Every operation fails with FEATURE_RESTRICTED.
 */
import { localError } from '../../api/client';
import type { AdapterEvent, MediaAdapter, ProviderState } from '../types';

const restricted = () => localError('FEATURE_RESTRICTED', 'Spotify 尚未啟用，需先完成整合核對。');

export class SpotifyDisabledAdapter implements MediaAdapter {
  start(): Promise<void> {
    return Promise.reject(restricted());
  }

  pause(): void {
    throw restricted();
  }

  resume(): Promise<void> {
    return Promise.reject(restricted());
  }

  seek(): void {
    throw restricted();
  }

  stop(): void {
    // Nothing is ever playing through this boundary.
  }

  getState(): ProviderState | null {
    return null;
  }

  subscribe(_listener: (event: AdapterEvent) => void): () => void {
    return () => undefined;
  }

  destroy(): void {
    // No SDK instance exists to tear down.
  }
}
