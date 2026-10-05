/**
 * S04 收聽頁, first-screen priority: context + provider status → soundscape → title/artist →
 * short Bridge → progress → transport → next up → tune. No second mini-player here.
 */
import { DeveloperOnly } from '../../app/developerMode';
import { useAppStore } from '../../app/appStore';
import { getEngine } from '../../app/services';
import { currentBridge, currentItem, nextItem } from '../../audio/queue';
import type { EngineState } from '../../audio/types';
import { useEngineState } from '../../audio/useEngine';
import { Button } from '../../ui/Button';
import { VibeList } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { FeedbackStep } from './FeedbackStep';
import { ManualControls } from './ManualControls';
import { LedgerWarnings } from './LedgerWarnings';
import { PlaybackBanner } from './PlaybackBanner';
import { ProviderNotices, SpeechFallbackNotice } from './ProviderNotices';
import { DjStrip, SeekBar, Transport } from './PlayerControls';
import { isSpeechPhase } from './phase';
import styles from './player.module.css';
import { DeviceStatusPill } from '../spotify/DeviceStatusView';
import { useDeviceStatus } from '../spotify/deviceStatus';
import { ModeStrip } from '../spotify/ModeStrip';
import { DevicePanel } from '../spotify/SpotifyPanels';
import { ListenArtwork } from './ListenArtwork';
import { modeStrip } from '../spotify/spotifyMode';

/** Empty state with a next step — never a disabled dead end (docs/02 導覽規則). */
export function ListenEmpty() {
  const setTab = useAppStore((s) => s.setTab);
  return (
    <section className={styles.empty} aria-labelledby="listen-empty-title">
      <div className={styles.emptyIcon}>
        <Icon name="listen" size={30} />
      </div>
      <h1 id="listen-empty-title">
        你的頻率，
        <br />
        從一個感覺開始。
      </h1>
      <p>還沒有正在收聽的節目。先給電台一個起點吧。</p>
      <Button block trailingIcon="arrow" onClick={() => setTab('home')}>
        去開台
      </Button>
    </section>
  );
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 僅開發者模式掛載：模式列＋常駐裝置狀態。 */
function SpotifyStatusBar({ state }: { state: EngineState }) {
  const caps = useAppStore((s) => s.capabilities);
  const status = useDeviceStatus();
  return (
    <>
      <ModeStrip labels={modeStrip(caps, state.playbackMode)} />
      <DeviceStatusPill status={status} />
    </>
  );
}

function ListenHeader({ state }: { state: EngineState }) {
  const openSheet = useAppStore((s) => s.openSheet);
  const position = state.currentIndex + 1;
  return (
    <div className={styles.listenTop}>
      <div className={styles.listenContext}>
        <p className={styles.kicker}>你的私人電台</p>
        <p className={styles.seedLine}>{state.show?.seed.text}</p>
      </div>
      <button
        type="button"
        className={styles.countPill}
        onClick={() => openSheet('queue')}
        aria-label={`查看節目單，目前第 ${position} 首，共 ${state.queue.length} 首`}
        data-testid="count-pill"
      >
        {pad2(position)} / {pad2(state.queue.length)}
      </button>
    </div>
  );
}

function BridgeCard({ state }: { state: EngineState }) {
  const openSheet = useAppStore((s) => s.openSheet);
  const bridge = currentBridge(state);
  if (!bridge) return null;
  return (
    <button type="button" className={styles.bridgeCard} onClick={() => openSheet('bridge')} data-testid="bridge-card" data-bridge-kind={bridge.kind}>
      <span className={styles.bridgeTitle}>
        <span>
          <Icon name="spark" size={16} />
          {bridge.kind === 'transition' ? `接續：${bridge.fromTitle} → 這一首` : '為什麼是這首'}
        </span>
        <span className={styles.bridgeMore}>
          完整理由
          <Icon name="chevron" size={16} />
        </span>
      </span>
      <span className={styles.bridgeCopy}>{bridge.text}</span>
    </button>
  );
}

function NextUp({ state }: { state: EngineState }) {
  const openSheet = useAppStore((s) => s.openSheet);
  const next = nextItem(state);
  return (
    <div className={styles.listenBottom}>
      <button type="button" className={styles.nextPreview} onClick={() => openSheet('queue')} data-testid="next-up">
        <span className={styles.queueIcon}>
          <Icon name="queue" size={20} />
        </span>
        <span className={styles.nextCopy}>
          <small>接下來 · 查看節目單</small>
          <strong>{next ? next.segment.candidate.title : '這一段的最後一首'}</strong>
        </span>
      </button>
      <Button variant="text" icon="sliders" className={styles.tuneLink} onClick={() => openSheet('tune')} data-testid="open-tune">
        微調
      </Button>
    </div>
  );
}

function CompletedCard() {
  const setTab = useAppStore((s) => s.setTab);
  return (
    <section className={styles.completed} aria-label="節目已結束" data-testid="show-completed">
      <h2>這一段節目聽完了。</h2>
      <p>不會自動生成無限接續；想繼續就從頭再聽，或建立下一段。</p>
      <div className={styles.completedActions}>
        <Button block icon="play" onClick={() => getEngine().play()}>
          從頭再聽一次
        </Button>
        <Button block variant="outline" onClick={() => setTab('home')}>
          建立下一段
        </Button>
      </div>
    </section>
  );
}

export function ListenPage() {
  const state = useEngineState();
  const item = currentItem(state);
  if (!item || state.queue.length === 0) return <ListenEmpty />;
  const { candidate, track } = item.segment;
  // Vibe chips step aside during the intro so the transport stays on the first screen.
  const inIntro = isSpeechPhase(state);
  const manualTrack = state.phase === 'manual_ready' || state.phase === 'manual_playing';
  const feedback = state.phase === 'feedback';
  const engine = getEngine();
  const eMode = state.playbackMode === 'spotify';
  // Spotify 對應到的曲目：顯示封面＋正式 metadata＋Spotify 標示與外連（Policy II.4／II.5）。
  const spotifyTrack = track.provider === 'spotify' && track.availability === 'resolved';
  return (
    <section className={styles.listen} aria-label="正在收聽" data-testid="listen-page">
      <LedgerWarnings warnings={state.show?.warnings ?? []} />
      <ProviderNotices warnings={state.show?.warnings ?? []} />
      <PlaybackBanner state={state} />
      {state.speechFallbackId === item.segment.segmentId && (
        <SpeechFallbackNotice djLine={currentBridge(state)?.djLine ?? candidate.djLine} onRetry={() => engine.replayIntro()} />
      )}
      {eMode && <DeveloperOnly><SpotifyStatusBar state={state} /></DeveloperOnly>}
      <ListenHeader state={state} />
      {/* 回饋時也保留曲目視覺與曲名：回饋卡要讓人知道是在回饋哪一首（BRA-117）。 */}
      <ListenArtwork state={state} segment={item.segment} />
      <div className={styles.songHeading}>
        {feedback && <p className={styles.kicker} data-testid="feedback-for">剛剛聽的這一首</p>}
        <h1 data-testid="track-title">{candidate.title}</h1>
        <p>
          {candidate.artist} {track.provider === 'mock' && <DeveloperOnly><span className={styles.mockTag}>MOCK 虛構曲目</span></DeveloperOnly>}
          {spotifyTrack && <span className={styles.mockTag}>AI 提名</span>}
        </p>
      </div>
      {!inIntro && !feedback && <VibeList vibes={candidate.vibe} />}
      {!feedback && <BridgeCard state={state} />}
      <DjStrip state={state} />
      {feedback ? <FeedbackStep key={`${state.sessionId}-${state.attemptId}`} state={state} /> :
        state.phase === 'completed' ? <CompletedCard /> :
        manualTrack ? <ManualControls phase={state.phase} onStart={() => engine.manualStarted()} onFinish={() => engine.manualFinished()} onSkip={() => engine.next()} /> :
        <><SeekBar state={state} /><Transport state={state} /></>}

      {eMode && <DeveloperOnly><DevicePanel /></DeveloperOnly>}
      <NextUp state={state} />
    </section>
  );
}
