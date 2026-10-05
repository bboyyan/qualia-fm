/**
 * 勾選清單（BRA-117）：開台的種子清單與 Ready 的 5 首共用同一個元件——
 * 一個「全選」切換、已選數量、每列原生核取方塊（鍵盤／讀屏可用）。
 */
import { useId, type ReactNode } from 'react';
import { isAllSelected } from './selection';
import styles from './seed.module.css';

export interface SelectableItem {
  readonly id: string;
  readonly title: string;
  readonly meta?: string | null;
  readonly note?: string | null;
  readonly tag?: ReactNode;
}

interface SelectableListProps {
  label: string;
  items: readonly SelectableItem[];
  selected: readonly string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  /** 有給才顯示每列的「移除」（例如使用者自己加入的種子）。 */
  onRemove?: (id: string) => void;
  removable?: (id: string) => boolean;
  testId?: string;
}

export function SelectableList({ label, items, selected, onToggle, onToggleAll, onRemove, removable, testId }: SelectableListProps) {
  const all = isAllSelected(items.map((item) => item.id), selected);
  const count = items.filter((item) => selected.includes(item.id)).length;
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className={styles.pickList} data-testid={testId}>
      <div className={styles.pickHead}>
        <h2 id={labelId}>{label}</h2>
        <span className={styles.pickCount} aria-live="polite">已選 {count}／{items.length}</span>
        <button type="button" className={styles.pickAll} aria-pressed={all} onClick={onToggleAll} data-testid={testId ? `${testId}-all` : undefined}>
          {all ? '取消全選' : '全選'}
        </button>
      </div>
      <ul>
        {items.map((item) => {
          const checked = selected.includes(item.id);
          return (
            <li key={item.id} className={checked ? `${styles.pickRow} ${styles.pickRowOn}` : styles.pickRow}>
              <label>
                <input type="checkbox" checked={checked} onChange={() => onToggle(item.id)} />
                <span className={styles.pickText}>
                  {item.tag && <span className={styles.pickTag}>{item.tag}</span>}
                  <strong>{item.title}</strong>
                  {item.meta && <span className={styles.pickMeta}>{item.meta}</span>}
                  {item.note && <span className={styles.pickNote}>{item.note}</span>}
                </span>
              </label>
              {onRemove && removable?.(item.id) && (
                <button type="button" className={styles.pickRemove} onClick={() => onRemove(item.id)} aria-label={`從清單移除：${item.title}`}>
                  移除
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
