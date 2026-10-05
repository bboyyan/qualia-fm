import { useEffect, useState } from 'react';
import type { PlaybackMode } from '../audio/types';
import { LINK_MESSAGES, effectivePlaybackMode, readLinkOutcome } from '../features/spotify/spotifyMode';
import { api } from './services';
import { useAppStore, type Tab } from './appStore';

/** 實際播放模式：伺服器核可＋已連結且使用者沒改回 B／MOCK 時才是 E（spotify）。 */
export function useEffectivePlaybackMode(): PlaybackMode {
  const settingsMode = useAppStore((s) => s.settings.playbackMode);
  const caps = useAppStore((s) => s.capabilities);
  const eMode = useAppStore((s) => s.eMode);
  return effectivePlaybackMode(settingsMode, caps, eMode);
}

/** Spotify 授權回到 /?spotify=… 時顯示結果並清掉網址參數（不含任何 code／state）。 */
function announceLinkOutcome(): void {
  const outcome = readLinkOutcome(window.location.search);
  if (!outcome) return;
  window.history.replaceState(window.history.state, '', window.location.pathname);
  const store = useAppStore.getState();
  store.showToast(LINK_MESSAGES[outcome]);
  if (outcome === 'linked') {
    store.setEMode('on');
    store.setTab('settings');
  }
}

/** Creates the anonymous session and reads the server's real capabilities once. */
export function useBoot(): void {
  const setBoot = useAppStore((s) => s.setBoot);
  useEffect(() => {
    const controller = new AbortController();
    api
      .ensureSession()
      .then(() => api.capabilities(controller.signal))
      .then((caps) => {
        setBoot('ready', caps);
        announceLinkOutcome();
      })
      .catch(() => {
        if (!controller.signal.aborted) setBoot('error');
      });
    return () => controller.abort();
  }, [setBoot]);
}

const TABS: readonly Tab[] = ['home', 'listen', 'settings'];

/** Back closes the sheet first; otherwise returns to the tab stored in history state. */
export function usePopStateNavigation(): void {
  useEffect(() => {
    window.history.replaceState({ qfmTab: useAppStore.getState().tab }, '');
    const onPop = (event: PopStateEvent) => {
      const store = useAppStore.getState();
      const state = event.state as { qfmTab?: Tab; qfmSheet?: string } | null;
      if (store.sheet && !state?.qfmSheet) {
        store.closeSheet({ fromHistory: true });
        return;
      }
      if (state?.qfmTab && TABS.includes(state.qfmTab)) store.setTab(state.qfmTab, { fromHistory: true });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
}

const KEYBOARD_THRESHOLD_PX = 150;

/** True while an on-screen keyboard is likely covering the layout viewport (visualViewport). */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const typing = document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement;
      setOpen(typing && window.innerHeight - viewport.height > KEYBOARD_THRESHOLD_PX);
    };
    viewport.addEventListener('resize', update);
    document.addEventListener('focusout', update);
    return () => {
      viewport.removeEventListener('resize', update);
      document.removeEventListener('focusout', update);
    };
  }, []);
  return open;
}
