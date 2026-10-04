import { HomePage } from '../features/seed/HomePage';
import { ListenPage } from '../features/player/ListenPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { InlineRecovery } from '../ui/Feedback';
import { Button } from '../ui/Button';
import { AppShell } from './AppShell';
import { EnvironmentSheet } from './EnvironmentSheet';
import { useAppStore } from './appStore';
import { useBoot, usePopStateNavigation } from './hooks';

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

export function App() {
  useBoot();
  usePopStateNavigation();
  const tab = useAppStore((s) => s.tab);
  const boot = useAppStore((s) => s.boot);
  const showToast = useAppStore((s) => s.showToast);
  return (
    <AppShell sheets={<EnvironmentSheet />}>
      {boot === 'error' && <BootError />}
      {tab === 'home' && <HomePage hasActiveShow={false} onStartShow={() => showToast('播放引擎將在 T04 接上。')} />}
      {tab === 'listen' && <ListenPage />}
      {tab === 'settings' && <SettingsPage />}
    </AppShell>
  );
}
