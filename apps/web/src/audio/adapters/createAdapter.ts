/**
 * Chooses the adapter from the server's capability report — never from provider names, query
 * strings or model output. Spotify stays a closed boundary unless the server gate is open, and
 * even then this build ships no SDK implementation.
 */
import type { Capabilities } from '@qualia/contracts';
import { localError } from '../../api/client';
import type { MediaAdapter } from '../types';
import { HtmlAudioAdapter, licensedSourceResolver, mockSourceResolver } from './htmlAudioAdapter';
import { SpotifyDisabledAdapter } from './spotifyAdapter';

export function createAdapter(caps: Pick<Capabilities, 'mode' | 'spotifyEnabled'>): MediaAdapter {
  switch (caps.mode) {
    case 'mock':
      return new HtmlAudioAdapter(mockSourceResolver());
    case 'licensed':
      return new HtmlAudioAdapter(licensedSourceResolver(window.location.origin));
    case 'spotify':
      return new SpotifyDisabledAdapter();
    case 'external':
      throw localError('FEATURE_RESTRICTED', '外部播放模式不在本站播放，請到外部 App 收聽。');
  }
}
