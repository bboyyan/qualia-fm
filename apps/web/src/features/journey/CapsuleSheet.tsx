/**
 * 「旅程」底部面板：有膠囊就呈現膠囊（打開即標記已開），並在下方說明目前這段旅程的進度與規則。
 */
import { useEffect, useSyncExternalStore } from 'react';
import { useAppStore } from '../../app/appStore';
import { BottomSheet } from '../../ui/BottomSheet';
import { CapsuleCard } from './CapsuleCard';
import { GEMS_PER_CAPSULE, type Gem } from './journey';
import type { JourneyTracker } from './journeyTracker';
import { GemSlots } from './GemTray';
import styles from './journey.module.css';

const stepText = (gem: Gem): string => (gem.kind === 'seed' ? `種子：${gem.seed}` : `${gem.source === 'listened' ? '聽完' : '回饋'}：${gem.title}`);

export function CapsuleSheet({ tracker }: { tracker: JourneyTracker }) {
  const open = useAppStore((s) => s.sheet === 'capsule');
  const closeSheet = useAppStore((s) => s.closeSheet);
  const journey = useSyncExternalStore(tracker.subscribe, tracker.getState, tracker.getState);
  useEffect(() => {
    if (open) tracker.openCapsule();
  }, [open, journey.capsule, tracker]);
  const left = GEMS_PER_CAPSULE - journey.gems.length;
  return (
    <BottomSheet open={open} title={journey.capsule ? '旅程膠囊' : `這趟 ${journey.gems.length}/${GEMS_PER_CAPSULE}`} onClose={() => closeSheet()} testId="capsule-sheet">
      {journey.capsule && <CapsuleCard capsule={journey.capsule} />}
      <section className={styles.progress} aria-labelledby="journey-progress-title" data-testid="journey-progress">
        <h3 id="journey-progress-title">{journey.capsule ? '下一段旅程' : '這一段旅程'}</h3>
        <p className={styles.progressLine}>
          <GemSlots gems={journey.gems} />
          <span>這趟 {journey.gems.length}/{GEMS_PER_CAPSULE}，還差 {left} 格開膠囊。</span>
        </p>
        {journey.gems.length > 0 && (
          <ul className={styles.gemList}>
            {journey.gems.map((gem) => (
              <li key={gem.key}>{stepText(gem)}</li>
            ))}
          </ul>
        )}
        <p className={styles.rule}>開台的種子算一格；一首歌聽完或留下回饋再走一格。滿 {GEMS_PER_CAPSULE} 格開出旅程膠囊。這趟進度只留在這次開啟的頁面，重新整理後重來；五首聽完翻牌留下的寶石會收進寶石牆。</p>
      </section>
    </BottomSheet>
  );
}
