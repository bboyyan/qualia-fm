/**
 * Mobile-first shell: brand + truthful mode badge, one scroll container, explicit 3-tab nav
 * with labels, optional mini-player above the nav (never on the listen tab), toast + live region.
 */
import type { CSSProperties, ReactNode } from 'react';
import { CapabilityBadge } from '../ui/Feedback';
import { Icon, type IconName } from '../ui/Icon';
import { Toast } from '../ui/Toast';
import { useAppStore, type Tab } from './appStore';
import { useEffectivePlaybackMode, useKeyboardOpen } from './hooks';
import styles from './shell.module.css';

const NAV: readonly { tab: Tab; label: string; icon: IconName }[] = [
  { tab: 'home', label: '開台', icon: 'radio' },
  { tab: 'listen', label: '收聽', icon: 'listen' },
  { tab: 'settings', label: '設定', icon: 'sliders' },
];

interface AppShellProps {
  children: ReactNode;
  miniPlayer?: ReactNode;
  sheets?: ReactNode;
}

function TopBar() {
  const providerMode = useAppStore((s) => s.capabilities?.mode ?? 'mock');
  // E 模式實際由 Spotify 播放時如實改標 Spotify（避免誤以為仍是 MOCK）；其他情況與以前相同。
  const mode = useEffectivePlaybackMode() === 'spotify' ? 'spotify' : providerMode;
  const openSheet = useAppStore((s) => s.openSheet);
  return (
    <header className={styles.topbar}>
      <p className={styles.brand} aria-label="Qualia FM">
        Qualia <span>fm</span>
      </p>
      <CapabilityBadge mode={mode} onClick={() => openSheet('environment')} />
    </header>
  );
}

function BottomNav() {
  const tab = useAppStore((s) => s.tab);
  const setTab = useAppStore((s) => s.setTab);
  return (
    <nav className={styles.nav} aria-label="主要導覽">
      {NAV.map((item) => (
        <button
          key={item.tab}
          type="button"
          className={styles.navButton}
          aria-current={item.tab === tab ? 'page' : undefined}
          onClick={() => setTab(item.tab)}
          data-testid={`tab-${item.tab}`}
        >
          <Icon name={item.icon} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

/** Toast rendered inside the open sheet so its Undo stays reachable (the page is inert). */
export function SheetToast() {
  const toast = useAppStore((s) => s.toast);
  const dismissToast = useAppStore((s) => s.dismissToast);
  return <Toast toast={toast} onDismiss={dismissToast} placement="sheet" />;
}

export function AppShell({ children, miniPlayer, sheets }: AppShellProps) {
  const sheetOpen = useAppStore((s) => s.sheet !== null);
  const toast = useAppStore((s) => s.toast);
  const dismissToast = useAppStore((s) => s.dismissToast);
  const live = useAppStore((s) => s.live);
  const keyboardOpen = useKeyboardOpen();
  const hasMini = Boolean(miniPlayer);
  const style = { '--toast-offset': hasMini ? '164px' : '84px' } as CSSProperties;

  return (
    <div className={styles.shell} data-mini={hasMini} data-keyboard={keyboardOpen} style={style}>
      <TopBar />
      <main id="main" className={styles.main}>
        {children}
      </main>
      <div className={styles.bottom}>
        {miniPlayer}
        <BottomNav />
      </div>
      {!sheetOpen && <Toast toast={toast} onDismiss={dismissToast} placement="page" />}
      {sheets}
      <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="live-region">
        {live}
      </div>
      <aside className={styles.side} aria-label="關於 Qualia FM">
        <h2>Feel the connection.</h2>
        <p>手機優先的私人電台。不是找同類型，是找到同一種感覺。</p>
        <p>目前為 MOCK 模式：只播放合成測試音，曲目皆為虛構。</p>
      </aside>
    </div>
  );
}
