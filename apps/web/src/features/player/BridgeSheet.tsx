/**
 * S05 為什麼是這首: hook of feeling, the concrete link, three vibe words, Sonic DNA facets, the DJ
 * line as text, and an honest evidence note. Opening it never triggers a new generation.
 */
import { useAppStore } from '../../app/appStore';
import { SheetToast } from '../../app/AppShell';
import { getEngine } from '../../app/services';
import { currentBridge, currentItem } from '../../audio/queue';
import { useEngineState } from '../../audio/useEngine';
import { BottomSheet } from '../../ui/BottomSheet';
import { Button } from '../../ui/Button';
import { VibeList } from '../../ui/controls';
import { SonicDnaGrid } from '../seed/SonicDna';
import styles from './sheets.module.css';

const EVIDENCE: Record<string, string> = {
  user_description: '依你的描述推測',
  licensed_editorial: '來自授權編輯資料',
  model_knowledge: '模型知識推測',
  unknown: '推薦推測，尚未聽音驗證',
};

export function BridgeSheet() {
  const open = useAppStore((s) => s.sheet === 'bridge');
  const closeSheet = useAppStore((s) => s.closeSheet);
  const state = useEngineState();
  const item = currentItem(state);
  const bridge = currentBridge(state);
  const canReplay = Boolean(item && state.djEnabled && item.segment.speech.kind !== 'none' && state.phase !== 'ready' && state.phase !== 'completed');
  return (
    <BottomSheet open={open && item !== null} title="為什麼是這首" onClose={() => closeSheet()} testId="bridge-sheet">
      <SheetToast />
      {item && bridge && state.show && (
        <>
          <p className={styles.lead}>
            {item.segment.candidate.title}
            <br />
            讓推薦有一個聽得懂的理由。
          </p>
          {bridge.kind === 'transition' && (
            <div className={`${styles.quote} ${styles.quoteTransition}`} data-testid="bridge-transition">
              <p className={styles.quoteEyebrow}>接續：{bridge.fromTitle} → 這一首</p>
              <p className={styles.quoteText}>{bridge.text}</p>
            </div>
          )}
          <div className={styles.quote}>
            <p className={styles.quoteEyebrow}>THE BRIDGE · 與起點的連結</p>
            <p className={styles.quoteText}>{item.segment.candidate.seedBridge}</p>
          </div>
          <VibeList vibes={item.segment.candidate.vibe} />
          <h3 className={styles.subhead}>這一段的感覺鉤子</h3>
          <p className={styles.body}>{state.show.analysis.hookOfFeeling}</p>
          <SonicDnaGrid analysis={state.show.analysis} />
          <h3 className={styles.subhead}>DJ 串詞（文字）</h3>
          <p className={styles.body}>「{bridge.djLine}」</p>
          <Button
            variant="outline"
            block
            icon="sound"
            disabled={!canReplay}
            onClick={() => {
              getEngine().replayIntro();
              closeSheet();
            }}
          >
            {canReplay ? '重聽介紹' : '目前無法重聽介紹'}
          </Button>
          <p className={styles.disclaimer} data-testid="bridge-evidence">
            可信度：{EVIDENCE[item.segment.candidate.evidenceLevel] ?? EVIDENCE.unknown}。{item.segment.candidate.uncertainty ?? ''}
            找到歌曲不代表已分析歌曲；這裡的聲景描述都是主觀推測。
          </p>
        </>
      )}
    </BottomSheet>
  );
}
