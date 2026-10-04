import { useEffect } from 'react';
import { bindMediaSession } from '../audio/mediaSession';
import { useEngineState } from '../audio/useEngine';
import { HomePage } from '../features/seed/HomePage';
import { ListenPage } from '../features/player/ListenPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { InlineRecovery } from '../ui/Feedback';
import { Button } from '../ui/Button';
import { AppShell } from './AppShell';
import { EnvironmentSheet } from './EnvironmentSheet';
import { useAppStore } from './appStore';
import { useBoot, usePopStateNavigation } from './hooks';
import { generation, getEngine } from './services';

function BootError() {
  return (
    <InlineRecovery
      tone="offline"
      title="暫時連不上電台服務"
      actions={
        <Button variant="outline" block onClick={() => window.location.reload()}>
          重新連線
        </Button>
      }
    >
      請確認服務已啟動（pnpm dev 或 pnpm start），你的輸入不會遺失。
    </InlineRecovery>
  );
}

/** Engine-wide side effects: DJ setting, lock-screen controls, foreground reconcile. */
function useEngineBindings(): void {
  const djEnabled = useAppStore((s) => s.settings.djEnabled);
  useEffect(() => {
    getEngine().setDjEnabled(djEnabled);
  }, [djEnabled]);
  useEffect(() => {
    const engine = getEngine();
    const unbind = bindMediaSession(engine);
    const onVisible = () => {
      if (document.visibilityState === 'visible') engine.reconcile();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      unbind();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, []);
}

/**
 * Starts the ready show from the user's tap: load + play run synchronously in the click handler
 * so the single audio element is unlocked by this gesture. Switching shows is always explicit.
 */
function startReadyShow(): void {
  const show = generation.getState().show;
  if (!show || show.segments.length === 0) return;
  const engine = getEngine();
  engine.loadShow(show);
  engine.play();
  generation.reset();
  useAppStore.getState().setTab('listen');
}

export function App() {
  useBoot();
  usePopStateNavigation();
  useEngineBindings();
  const tab = useAppStore((s) => s.tab);
  const boot = useAppStore((s) => s.boot);
  const engineState = useEngineState();
  const hasActiveShow = engineState.queue.length > 0;
  return (
    <AppShell sheets={<EnvironmentSheet />}>
      {boot === 'error' && <BootError />}
      {tab === 'home' && <HomePage hasActiveShow={hasActiveShow} onStartShow={startReadyShow} />}
      {tab === 'listen' && <ListenPage />}
      {tab === 'settings' && <SettingsPage />}
    </AppShell>
  );
}
