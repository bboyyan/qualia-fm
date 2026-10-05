/**
 * 收聽頁首屏的小寶石盤：5 格＋數字，一個 48px 點按區，不佔整塊卡片（對齊 BRA-125 清雜）。
 * 膠囊開出且還沒打開時，改成「膠囊開好了」。
 */
import { useSyncExternalStore } from 'react';
import { GEMS_PER_CAPSULE, type Gem } from './journey';
import type { JourneyTracker } from './journeyTracker';
import styles from './journey.module.css';

const gemKind = (gem: Gem | undefined): string => (!gem ? 'empty' : gem.kind === 'seed' ? 'seed' : gem.source);

export function GemSlots({ gems }: { gems: readonly Gem[] }) {
  return (
    <span className={styles.gems} aria-hidden="true">
      {Array.from({ length: GEMS_PER_CAPSULE }, (_, i) => (
        <span key={i} className={styles.gem} data-gem={gemKind(gems[i])} />
      ))}
    </span>
  );
}

interface GemTrayProps {
  tracker: JourneyTracker;
  onOpen: () => void;
}

export function GemTray({ tracker, onOpen }: GemTrayProps) {
  const journey = useSyncExternalStore(tracker.subscribe, tracker.getState, tracker.getState);
  const ready = journey.capsule !== null && !journey.capsuleOpened;
  const count = journey.gems.length;
  return (
    <button
      type="button"
      className={ready ? `${styles.tray} ${styles.trayReady}` : styles.tray}
      onClick={onOpen}
      aria-label={ready ? '旅程膠囊開好了，打開' : `旅程寶石 ${count}／${GEMS_PER_CAPSULE}，查看旅程`}
      data-testid="gem-tray"
      data-gems={count}
    >
      <GemSlots gems={ready ? (journey.capsule?.gems ?? []) : journey.gems} />
      <span className={styles.trayLabel}>{ready ? '膠囊' : `${count}/${GEMS_PER_CAPSULE}`}</span>
    </button>
  );
}
