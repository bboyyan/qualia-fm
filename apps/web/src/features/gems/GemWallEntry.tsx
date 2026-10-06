/**
 * 首屏寶石牆入口條（BRA-169，設計稿 01）：一條夜色細卡＝進度＋一句話＋「寶石牆 ›」，整條可點。
 * 不另加頂欄徽章，避免首屏塞滿（BRA-125）。讀不到牆時仍顯示入口，只是不帶數字。
 */
import { useEffect, useSyncExternalStore } from 'react';
import { GEMS_PER_SELECTION } from '@qualia/contracts';
import { Icon } from '../../ui/Icon';
import { GemIcon } from './GemIcon';
import { entryLine, pad2 } from './gemCopy';
import type { GemWallModel } from './gemWallModel';
import styles from './gems.module.css';

export function GemWallEntry({ model, onOpen }: { model: GemWallModel; onOpen: () => void }) {
  const { wall } = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  useEffect(() => {
    void model.load();
  }, [model]);
  const gems = wall?.current.gems ?? [];
  const line = wall ? entryLine(wall) : '看看你留下的寶石';
  const label = wall ? `寶石牆，旅程精選集 No.${pad2(wall.current.no)} 已收 ${gems.length}／${GEMS_PER_SELECTION} 顆。${line}` : '寶石牆';
  return (
    <button type="button" className={styles.entry} onClick={onOpen} aria-label={label} data-testid="gem-wall-entry" data-gems={gems.length}>
      <span className={styles.entryKicker}>GEM WALL{wall ? ` · 精選集 NO.${pad2(wall.current.no)}` : ''}</span>
      {wall && (
        <span className={styles.entryCount}>
          {gems.length}
          <small>/{GEMS_PER_SELECTION}</small>
        </span>
      )}
      <span className={styles.entryGems} aria-hidden="true">
        {Array.from({ length: GEMS_PER_SELECTION }, (_, i) => {
          const gem = gems[i];
          return gem ? <GemIcon key={i} palette={gem.palette} size={24} /> : <GemIcon key={i} empty size={24} />;
        })}
      </span>
      <span className={styles.entryLine}>{line}</span>
      <span className={styles.entryMore}>
        寶石牆
        <Icon name="chevron" size={16} />
      </span>
    </button>
  );
}
