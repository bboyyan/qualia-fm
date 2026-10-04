import { Button } from '../../ui/Button';
import styles from './player.module.css';

export function DjIntroduction({ djLine, paused, aiVoice = false, onSkip }: { djLine: string; paused: boolean; aiVoice?: boolean; onSkip: () => void }) {
  return (
    <section className={styles.djStrip} aria-label="DJ 介紹" data-testid="dj-strip">
      <div className={styles.djHead}>
        <p>{paused ? '介紹已暫停' : 'DJ 正在介紹'}<span> · {aiVoice ? 'AI 合成語音' : 'MOCK 提示音，非 AI 語音'}</span></p>
        <Button variant="text" trailingIcon="chevron" onClick={onSkip} data-testid="skip-intro">跳過介紹</Button>
      </div>
      <p className={styles.djLine}>「{djLine}」</p>
    </section>
  );
}
