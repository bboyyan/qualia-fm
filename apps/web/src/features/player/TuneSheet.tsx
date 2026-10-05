/**
 * S07 微調: only the upcoming tail changes; the current song is never interrupted. One job at a
 * time; cancel changes nothing; failure keeps the old tail.
 */
import { useId, useState } from 'react';
import { TUNING_MAX_GRAPHEMES, countGraphemes } from '@qualia/contracts';
import { useAppStore } from '../../app/appStore';
import { SheetToast } from '../../app/AppShell';
import { getEngine, tuneGeneration } from '../../app/services';
import { useEngineState } from '../../audio/useEngine';
import { BottomSheet } from '../../ui/BottomSheet';
import { Button } from '../../ui/Button';
import { InlineRecovery } from '../../ui/Feedback';
import { useGeneration } from '../seed/useGeneration';
import { captureTuneContext, pendingTune, tuneRequest } from './tuneFlow';
import styles from './sheets.module.css';

const QUICK = ['再安靜一點', '多一點溫暖', '節奏輕快些', '留更多空間'] as const;

const PHASE_TEXT: Record<string, string> = {
  queued: '排隊中…',
  understanding: '理解你的微調…',
  matching: '配對新的聲景…',
  resolving: '確認候選曲目…',
  preparing: '準備接下來的節目…',
  done: '準備好了',
};

export function TuneSheet() {
  const open = useAppStore((s) => s.sheet === 'tune');
  const closeSheet = useAppStore((s) => s.closeSheet);
  const settings = useAppStore((s) => s.settings);
  const engineState = useEngineState();
  const tune = useGeneration(tuneGeneration);
  const fieldId = useId();
  const [text, setText] = useState('');
  const running = tune.status === 'running';
  const count = countGraphemes(text);
  const invalid = text.trim().length === 0 || count > TUNING_MAX_GRAPHEMES;

  const apply = () => {
    const context = captureTuneContext(getEngine());
    if (invalid || !context || !engineState.show || running) return;
    pendingTune.current = context;
    void tuneGeneration.start(tuneRequest(engineState.show, text, { enabled: settings.djEnabled, length: settings.djLength }));
  };

  return (
    <BottomSheet open={open} title="把接下來，調近一點" onClose={() => closeSheet()} testId="tune-sheet">
      <SheetToast />
      <p className={styles.lead}>
        只調整接下來，<strong>不打斷這首</strong>。保留喜歡的部分，把距離再拉近一點。
      </p>
      <div className={styles.quick} role="group" aria-label="快速方向（只會填入）">
        {QUICK.map((q) => (
          <button key={q} type="button" className={styles.quickOption} aria-pressed={text === q} onClick={() => setText(q)} disabled={running}>
            {q}
          </button>
        ))}
      </div>
      <label className={styles.fieldLabel} htmlFor={fieldId}>
        也可以直接告訴 DJ（最多 {TUNING_MAX_GRAPHEMES} 字）
      </label>
      <textarea
        id={fieldId}
        className={styles.field}
        value={text}
        placeholder="說說接下來想聽的感覺。"
        onChange={(e) => setText(e.target.value)}
        maxLength={1000}
        disabled={running}
        data-testid="tune-input"
      />
      <p className={count > TUNING_MAX_GRAPHEMES ? `${styles.counter} ${styles.counterOver}` : styles.counter}>
        {count} / {TUNING_MAX_GRAPHEMES}
      </p>
      {running && (
        <InlineRecovery
          tone="info"
          title={PHASE_TEXT[tune.phase ?? 'queued'] ?? '準備中…'}
          testId="tune-running"
          actions={
            <Button variant="outline" block onClick={() => tuneGeneration.cancel()} data-testid="tune-cancel">
              取消（不改變任何曲目）
            </Button>
          }
        >
          目前這首會繼續播放；新的接下來準備好之前，原本的曲目都會保留。
        </InlineRecovery>
      )}
      {tune.status === 'failed' && tune.error && (
        <InlineRecovery tone="error" title="這次微調沒有成功" testId="tune-error">
          {tune.error.message} 原本的接下來都保留著。
        </InlineRecovery>
      )}
      {!running && (
        <Button block trailingIcon="arrow" disabled={invalid} onClick={apply} data-testid="tune-apply">
          套用到接下來
        </Button>
      )}
      <p className={styles.disclaimer}>只調整接下來的曲目，正在聽的這首不會中斷。</p>
    </BottomSheet>
  );
}
