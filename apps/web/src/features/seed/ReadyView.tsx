/**
 * S03 準備好／尚未播放. Ready is not playing: nothing moves until the user taps. Shows the real
 * playable count; 0 tracks keeps the analysis and the unconfirmed list with "修改感覺".
 * BRA-117：曲目用與種子清單同一個勾選清單，預設全選；主按鈕一鍵「全選・開始收聽」，只播勾選的。
 */
import { DeveloperOnly } from '../../app/developerMode';
import { useState } from 'react';
import { useAppStore } from '../../app/appStore';
import type { ShowPlan } from '@qualia/contracts';
import { LedgerWarnings } from '../player/LedgerWarnings';
import { ProviderNotices } from '../player/ProviderNotices';
import { Button } from '../../ui/Button';
import { Eyebrow, InlineRecovery } from '../../ui/Feedback';
import { SelectableList } from './SelectableList';
import { startLabel, toggleAll, toggleId } from './selection';
import { SonicDnaCard } from './SonicDna';
import styles from './seed.module.css';

interface ReadyViewProps {
  show: ShowPlan;
  hasActiveShow: boolean;
  /** 使用者勾選要聽的曲目（依節目順序）。 */
  onStart: (segmentIds: readonly string[]) => void;
  onBackToListen: () => void;
  onEdit: () => void;
  onRegenerate: () => void;
}

const TARGET = 5;

function PartialNotice({ show, onRegenerate }: { show: ShowPlan; onRegenerate: () => void }) {
  const count = show.segments.length;
  return (
    <div className={styles.partialNotice} data-testid="partial-notice">
      <span>先聽這 {count} 首。</span>
      <Button variant="text" onClick={onRegenerate}>重新選歌</Button>
    </div>
  );
}

function ZeroNotice({ show, onEdit }: { show: ShowPlan; onEdit: () => void }) {
  return (
    <InlineRecovery
      tone="warning"
      title="尚無可播曲目"
      testId="zero-notice"
      actions={
        <Button block onClick={onEdit}>
          修改感覺
        </Button>
      }
    >
      <p>感覺分析已保留。以下候選暫時無法確認，因此不會被標成可播：</p>
      <ul className={styles.pendingList}>
        {show.unavailable.map((c) => (
          <li key={c.candidateId}>
            {c.title} <span>· 待確認</span>
          </li>
        ))}
      </ul>
    </InlineRecovery>
  );
}

export function ReadyView({ show, hasActiveShow, onStart, onBackToListen, onEdit, onRegenerate }: ReadyViewProps) {
  const playbackMode = useAppStore((s) => s.settings.playbackMode);
  const count = show.segments.length;
  const ids = show.segments.map((segment) => segment.segmentId);
  const [selected, setSelected] = useState<readonly string[]>(ids);
  const chosen = ids.filter((id) => selected.includes(id));
  return (
    <section className={styles.ready} aria-labelledby="ready-title" data-testid="ready-view">
      <LedgerWarnings warnings={show.warnings} />
      <ProviderNotices warnings={show.warnings} />
      <Eyebrow>{count > 0 ? 'YOUR SHOW IS READY' : 'NOTHING PLAYABLE YET'}</Eyebrow>
      <h1 id="ready-title">{count > 0 ? '節目準備好了。' : '這次還沒有可播的曲目。'}</h1>
      <blockquote className={styles.seedQuote}>{show.seed.text}</blockquote>
      <SonicDnaCard analysis={show.analysis} compact />
      {count > 0 && count < TARGET && <PartialNotice show={show} onRegenerate={onRegenerate} />}
      {count === 0 && <ZeroNotice show={show} onEdit={onEdit} />}
      {count > 0 && (
        <>
          <SelectableList
            label={`今晚的 ${count} 首`}
            items={show.segments.map((segment) => ({
              id: segment.segmentId,
              title: segment.candidate.title,
              meta: segment.candidate.artist,
              note: segment.candidate.seedBridge,
            }))}
            selected={selected}
            onToggle={(id) => setSelected((current) => toggleId(current, id))}
            onToggleAll={() => setSelected((current) => toggleAll(ids, current))}
            testId="ready-tracks"
          />
          <div className={styles.stats}>
            <span data-testid="ready-count">已準備 {count} 首</span>
            <span>尚未開始播放</span>
          </div>
          <Button block icon="play" disabled={chosen.length === 0} onClick={() => onStart(chosen)} data-testid="start-listening">
            {startLabel(hasActiveShow ? '現在切換至新節目' : '開始收聽', chosen.length, count)}
          </Button>
          {chosen.length === 0 && <p className={styles.error} role="status">至少勾選一首才能開始。</p>}
          {hasActiveShow && (
            <Button block variant="outline" className={styles.secondary} onClick={onBackToListen}>
              先回到正在收聽
            </Button>
          )}
          <Button block variant="text" className={styles.secondary} onClick={onEdit}>
            再調整一下感覺
          </Button>
          <DeveloperOnly><p className={styles.genNote}>{playbackMode === 'manual' ? 'B 手動模式：曲目為 MOCK 虛構資料。介紹只有文字與合成提示音；音樂請自行在 Spotify app 點歌，本站不播放或控制 Spotify。' : '曲目皆為虛構；按下後只會播放合成測試音（MOCK），不是真實音樂。'}</p></DeveloperOnly>
        </>
      )}
    </section>
  );
}
