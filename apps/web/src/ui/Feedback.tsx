import type { ReactNode } from 'react';
import type { Mode } from '@qualia/contracts';
import { Icon, type IconName } from './Icon';
import styles from './ui.module.css';

const BADGE_COPY: Record<Mode, { label: string; detail: string }> = {
  mock: { label: 'MOCK', detail: '合成測試音' },
  licensed: { label: '授權音源', detail: '已核對來源' },
  spotify: { label: 'Spotify', detail: '經核可模式' },
  external: { label: '外部播放', detail: '本站不控制' },
};

interface CapabilityBadgeProps {
  mode: Mode;
  onClick?: () => void;
  compact?: boolean;
}

/** Truthful provider label. MOCK is always visible while mock audio is in use. */
export function CapabilityBadge({ mode, onClick, compact = false }: CapabilityBadgeProps) {
  const copy = BADGE_COPY[mode];
  const content = (
    <>
      <span className={styles.badgeDot} aria-hidden="true" />
      <strong>{copy.label}</strong>
      {!compact && <span className={styles.badgeDetail}>· {copy.detail}</span>}
    </>
  );
  if (!onClick) {
    return (
      <span className={styles.badge} data-testid="mode-badge-static">
        {content}
      </span>
    );
  }
  return (
    <button type="button" className={`${styles.badge} ${styles.badgeButton}`} onClick={onClick} data-testid="mode-badge" aria-label={`播放環境：${copy.label}，${copy.detail}。查看說明`}>
      {content}
    </button>
  );
}

type RecoveryTone = 'warning' | 'error' | 'offline' | 'info';

const TONE_ICON: Record<RecoveryTone, IconName> = { warning: 'alert', error: 'alert', offline: 'wifiOff', info: 'info' };

interface InlineRecoveryProps {
  tone: RecoveryTone;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  testId?: string;
}

/** Reason + next step, in the page flow (docs/02 S09). Alerts for errors, status otherwise. */
export function InlineRecovery({ tone, title, children, actions, testId }: InlineRecoveryProps) {
  return (
    <section className={`${styles.recovery} ${styles[`recovery-${tone}`]}`} role={tone === 'info' ? 'status' : 'alert'} data-testid={testId}>
      <div className={styles.recoveryHead}>
        <Icon name={TONE_ICON[tone]} size={20} />
        <h3>{title}</h3>
      </div>
      {children && <div className={styles.recoveryBody}>{children}</div>}
      {actions && <div className={styles.recoveryActions}>{actions}</div>}
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className={styles.eyebrow}>{children}</p>;
}
