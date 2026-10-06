import { DeveloperOnly } from './developerMode';
import { useEffect, useState } from 'react';
import { bindMediaSession } from '../audio/mediaSession';
import { useEngineState } from '../audio/useEngine';
import { HomePage } from '../features/seed/HomePage';
import { BridgeSheet } from '../features/player/BridgeSheet';
import { ListenPage } from '../features/player/ListenPage';
import { MiniPlayer } from '../features/player/MiniPlayer';
import { QueueSheet } from '../features/player/QueueSheet';
import { TuneSheet } from '../features/player/TuneSheet';
import { commitTune, commitTuneAnyway, pendingTune, type TuneOutcome } from '../features/player/tuneFlow';
import { SettingsPage } from '../features/settings/SettingsPage';
import { ShowHistoryPage } from '../features/history/ShowHistoryPage';
import { MySongsPage } from '../features/songs/MySongsPage';
import { CapsuleSheet } from '../features/journey/CapsuleSheet';
import { InlineRecovery } from '../ui/Feedback';
import { Button } from '../ui/Button';
import { AppShell } from './AppShell';
import { EnvironmentSheet } from './EnvironmentSheet';
import { useAppStore } from './appStore';
import { useBoot, useEffectivePlaybackMode, usePopStateNavigation } from './hooks';
import { generation, getEngine, journey, mySongs, tuneGeneration } from './services';
import { connectPlayer, syncSpotifyOutput } from './spotify';
import { effectivePlaybackMode } from '../features/spotify/spotifyMode';
import { pickSegments } from '../features/seed/selection';
import { songSeedRequest } from '../features/seed/seedList';
import type { ShowSummary, TrackMark } from '@qualia/contracts';

function BootError() {
  return (
    <InlineRecovery
      tone="offline"
      title="暫時連不上電台服務"
      actions={
        <Button variant="outline" block onClick={() => window.location.reload()}>
          重新連線
        </Button>
      }
    >
      請稍後再試，你的輸入不會遺失。
    </InlineRecovery>
  );
}

/** Engine-wide side effects: DJ setting, lock-screen controls, foreground reconcile. */
function useEngineBindings(): void {
  const playbackMode = useEffectivePlaybackMode();
  useEffect(() => {
    // E 模式才接上 Spotify 輸出（不載 SDK）；其他模式拔掉，router 回到單一 <audio>。
    syncSpotifyOutput(playbackMode === 'spotify');
    getEngine().setPlaybackMode(playbackMode);
  }, [playbackMode]);
  const djEnabled = useAppStore((s) => s.settings.djEnabled);
  useEffect(() => {
    getEngine().setDjEnabled(djEnabled);
  }, [djEnabled]);
  useEffect(() => {
    const engine = getEngine();
    const unbind = bindMediaSession(engine);
    const onVisible = () => {
      if (document.visibilityState === 'visible') engine.reconcile();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      unbind();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, []);
}

function reportTune(outcome: TuneOutcome, retry: () => void): void {
  const store = useAppStore.getState();
  if (outcome.kind === 'committed') {
    store.showToast(`已替換接下來的 ${outcome.count} 首；這首沒有中斷。`);
    store.closeSheet();
  } else if (outcome.kind === 'empty') {
    store.showToast('這次沒有找到可用的曲目，已保留原本的接下來。');
  } else if (outcome.kind === 'stale_revision') {
    store.showToast('節目單剛剛有變動，新的接下來還沒套用。', { label: '仍要套用', run: retry });
  } else {
    store.showToast('節目已經切換，這次微調已捨棄。');
  }
}

/** Commits a finished tune job against the context captured at tap time (docs/06). */
function useTuneCommit(): void {
  useEffect(
    () =>
      tuneGeneration.subscribe(() => {
        const state = tuneGeneration.getState();
        const context = pendingTune.current;
        if (state.status !== 'ready' || !state.show || !context) return;
        const show = state.show;
        pendingTune.current = null;
        tuneGeneration.reset();
        const engine = getEngine();
        reportTune(commitTune(engine, show, context), () => reportTune(commitTuneAnyway(engine, show, context.sessionId), () => undefined));
      }),
    [],
  );
}

/**
 * Starts the ready show from the user's tap: load + play run synchronously in the click handler
 * so the single audio element is unlocked by this gesture. Switching shows is always explicit.
 */
function startReadyShow(segmentIds: readonly string[]): void {
  const ready = generation.getState().show;
  if (!ready) return;
  // Ready 的勾選清單：只播勾選的曲目（預設全選）。
  const show = pickSegments(ready, segmentIds);
  if (show.segments.length === 0) return;
  const engine = getEngine();
  const store = useAppStore.getState();
  // E 模式：同一次點擊內接上 Qualia 播放器（載入 SDK＋activateElement），介紹播放期間完成連線。
  if (effectivePlaybackMode(store.settings.playbackMode, store.capabilities, store.eMode) === 'spotify') void connectPlayer();
  engine.loadShow(show);
  engine.play();
  generation.reset();
  useAppStore.getState().setTab('listen');
}

/** 「我的歌」→ 當種子開台：只用這首當種子開始編排，回到開台頁看進度（正在播的節目不中斷）。 */
function startFromSong(song: TrackMark): void {
  const store = useAppStore.getState();
  void generation.start(songSeedRequest(song.title, song.artist, store.settings));
  store.announce(`以〈${song.title}〉當種子開台`);
  store.setTab('home');
}

function startFromHistory(show: ShowSummary): void {
  const store = useAppStore.getState();
  void generation.start({ seed: show.seed, requestedCount: 5, dj: { enabled: store.settings.djEnabled, length: store.settings.djLength }, tuning: null });
  store.announce(`用「${show.seed.text}」重開`);
  store.setTab('home');
}

export function App() {
  const [minePage, setMinePage] = useState<'songs' | 'history'>('songs');
  useBoot();
  usePopStateNavigation();
  useEngineBindings();
  useTuneCommit();
  const tab = useAppStore((s) => s.tab);
  const boot = useAppStore((s) => s.boot);
  const engineState = useEngineState();
  const hasActiveShow = engineState.queue.length > 0;
  return (
    <AppShell
      miniPlayer={hasActiveShow && tab !== 'listen' ? <MiniPlayer state={engineState} /> : undefined}
      sheets={
        <>
          <DeveloperOnly><EnvironmentSheet /></DeveloperOnly>
          <BridgeSheet />
          <QueueSheet />
          <TuneSheet />
          <CapsuleSheet tracker={journey} />
        </>
      }
    >
      {boot === 'error' && <BootError />}
      {tab === 'home' && <HomePage hasActiveShow={hasActiveShow} onStartShow={startReadyShow} />}
      {tab === 'listen' && <ListenPage />}
      {tab === 'mine' && (minePage === 'history'
        ? <ShowHistoryPage onSongs={() => setMinePage('songs')} onSeed={startFromHistory} />
        : <MySongsPage model={mySongs} onSeed={startFromSong} onHistory={() => setMinePage('history')} />)}
      {tab === 'settings' && <SettingsPage />}
    </AppShell>
  );
}
