/**
 * Lock-screen metadata/controls for the engine-owned adapter (docs/04 PWA). This does not
 * guarantee background playback; artist text keeps the MOCK label visible on the OS UI too.
 */
import type { PlaybackEngine } from './engine';
import { isAudible } from './engine';
import { currentItem } from './queue';

export function bindMediaSession(engine: PlaybackEngine): () => void {
  if (!('mediaSession' in navigator)) return () => undefined;
  const session = navigator.mediaSession;
  let lastSegmentId: string | null = null;
  const sync = () => {
    const state = engine.getState();
    const item = currentItem(state);
    session.playbackState = isAudible(state) ? 'playing' : state.phase === 'paused' ? 'paused' : 'none';
    if (!item || item.segment.segmentId === lastSegmentId || typeof MediaMetadata === 'undefined') return;
    lastSegmentId = item.segment.segmentId;
    session.metadata = new MediaMetadata({
      title: item.segment.candidate.title,
      artist: `${item.segment.candidate.artist} · MOCK 合成測試音`,
      album: 'Qualia FM（MOCK）',
    });
  };
  const handlers: [MediaSessionAction, () => void][] = [
    ['play', () => engine.play()],
    ['pause', () => engine.pause()],
    ['nexttrack', () => engine.next()],
  ];
  for (const [action, handler] of handlers) {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // Unsupported action on this browser; the on-page controls remain available.
    }
  }
  const unsubscribe = engine.subscribe(sync);
  return () => {
    unsubscribe();
    for (const [action] of handlers) {
      try {
        session.setActionHandler(action, null);
      } catch {
        // ignore
      }
    }
  };
}
