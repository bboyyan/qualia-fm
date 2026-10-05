import { useId, useState } from 'react';
import { countGraphemes } from '@qualia/contracts';
import { Button } from '../../ui/Button';
import styles from './player.module.css';

/** 超過這個長度的引言預設收合成兩行（與舊短版同高），可展開看完整（BRA-117 加厚引言）。 */
const COLLAPSE_AFTER_GRAPHEMES = 40;

export function DjIntroduction({ djLine, paused, aiVoice = false, onSkip }: { djLine: string; paused: boolean; aiVoice?: boolean; onSkip: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const lineId = useId();
  const long = countGraphemes(djLine) > COLLAPSE_AFTER_GRAPHEMES;
  return (
    <section className={styles.djStrip} aria-label="DJ 介紹" data-testid="dj-strip">
      <div className={styles.djHead}>
        <p>{paused ? '介紹已暫停' : 'DJ 正在介紹'}<span> · {aiVoice ? 'AI 合成語音' : 'MOCK 提示音，非 AI 語音'}</span></p>
        <Button variant="text" trailingIcon="chevron" onClick={onSkip} data-testid="skip-intro">跳過介紹</Button>
      </div>
      {/* 展開鈕放在引言同一列（右下），不另佔一行：360 寬首屏仍要看得到播放鍵。 */}
      <div className={styles.djBody}>
        <p id={lineId} className={long && !expanded ? `${styles.djLine} ${styles.djLineClamp}` : styles.djLine}>「{djLine}」</p>
        {long && (
          <button type="button" className={styles.djMore} aria-expanded={expanded} aria-controls={lineId} onClick={() => setExpanded((open) => !open)} data-testid="dj-expand">
            {expanded ? '收合' : '看全文'}
          </button>
        )}
      </div>
    </section>
  );
}
