/**
 * S02 生成中. Stage checks appear only when the server has moved past that phase; there is no
 * percentage. Cancel keeps the input. Failures show reason + next step inline (docs/02 S02).
 */
import { DeveloperOnly } from '../../app/developerMode';
import { useEffect } from 'react';
import type { JobPhase } from '@qualia/contracts';
import { useAppStore } from '../../app/appStore';
import { Button } from '../../ui/Button';
import { Eyebrow, InlineRecovery } from '../../ui/Feedback';
import { Icon } from '../../ui/Icon';
import type { GenerationState } from './generationController';
import styles from './seed.module.css';

const STAGES: readonly { phase: JobPhase; label: string }[] = [
  { phase: 'understanding', label: '理解你的感覺' },
  { phase: 'matching', label: '配對相近的聲景' },
  { phase: 'resolving', label: '確認候選曲目' },
  { phase: 'preparing', label: '準備這一段節目' },
];

const ORDER: readonly JobPhase[] = ['queued', 'understanding', 'matching', 'resolving', 'preparing', 'done'];

type StageState = 'pending' | 'running' | 'done';

export function stageState(current: JobPhase | null, stage: JobPhase): StageState {
  const at = ORDER.indexOf(current ?? 'queued');
  const own = ORDER.indexOf(stage);
  if (at > own) return 'done';
  return at === own ? 'running' : 'pending';
}

interface GenerationViewProps {
  state: GenerationState;
  seedText: string;
  onCancel: () => void;
  onRetry: () => void;
  onEdit: () => void;
}

export function GenerationView({ state, seedText, onCancel, onRetry, onEdit }: GenerationViewProps) {
  const announce = useAppStore((s) => s.announce);
  const current = STAGES.find((s) => s.phase === state.phase);
  useEffect(() => {
    if (current) announce(current.label);
  }, [current, announce]);

  const failed = state.status === 'failed';
  const quotaExceeded = failed && state.error?.code === 'QUOTA_EXCEEDED';
  return (
    <section className={styles.generation} aria-labelledby="gen-title" data-testid="generation-view">
      <Eyebrow>{quotaExceeded ? 'USAGE LIMIT' : failed ? 'SIGNAL LOST' : 'FINDING YOUR FREQUENCY'}</Eyebrow>
      <h1 id="gen-title">{quotaExceeded ? '已達使用上限。' : failed ? '這次沒有順利開台。' : <>讓感覺，<br />慢慢成形。</>}</h1>
      <blockquote className={styles.seedQuote}>{seedText}</blockquote>
      {failed && state.error ? (
        <InlineRecovery
          tone={state.error.code === 'NETWORK_ERROR' ? 'offline' : 'error'}
          title={state.error.message}
          testId="generation-error"
          actions={
            <>
              {!quotaExceeded && <Button block onClick={onRetry}>{state.error.code === 'SESSION_EXPIRED' ? '重新建立並再試一次' : '再試一次'}</Button>}
              <Button block variant="text" onClick={onEdit}>修改感覺</Button>
            </>
          }
        >
          你的輸入已保留。{state.error.retryAfterMs ? `請約 ${Math.ceil(state.error.retryAfterMs / 1000)} 秒後再試。` : ''}
        </InlineRecovery>
      ) : (
        <>
          <ol className={styles.stages} aria-label="生成階段（伺服器實際狀態）">
            {STAGES.map((stage, i) => {
              const status = stageState(state.phase, stage.phase);
              return (
                <li key={stage.phase} className={styles[`stage-${status}`]} data-state={status} aria-current={status === 'running' ? 'step' : undefined}>
                  <span className={styles.stageDot} aria-hidden="true">
                    {status === 'done' ? <Icon name="check" size={14} /> : String(i + 1).padStart(2, '0')}
                  </span>
                  {stage.label}
                  <span className="sr-only">{status === 'done' ? '（完成）' : status === 'running' ? '（進行中）' : '（等待中）'}</span>
                </li>
              );
            })}
          </ol>
          {state.longWait && (
            <InlineRecovery tone="info" title="這次找歌比較久" testId="long-wait">
              你可以先取消，輸入會保留。
            </InlineRecovery>
          )}
          <Button block variant="outline" onClick={onCancel} data-testid="cancel-generation">
            取消，保留我的輸入
          </Button>
          <DeveloperOnly><p className={styles.genNote}>MOCK：不會呼叫 AI，也沒有分析任何音訊；階段文字來自伺服器實際進度。</p></DeveloperOnly>
        </>
      )}
    </section>
  );
}
