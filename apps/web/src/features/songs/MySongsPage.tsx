/**
 * 「我的」tab →「我的歌」（BRA-135）：一頁清單＋搜尋＋濾鏡（全部／收藏／封鎖／最近）。
 * 資料直接是品味帳本；不是帳本儀表板，不顯示統計、模式或測試資訊。
 */
import { useCallback, useEffect, useId, useState, useSyncExternalStore } from 'react';
import { PINNED_LIMIT, type TrackMark } from '@qualia/contracts';
import { useAppStore } from '../../app/appStore';
import { Button } from '../../ui/Button';
import { SegmentedControl } from '../../ui/controls';
import { Eyebrow, InlineRecovery } from '../../ui/Feedback';
import { Icon } from '../../ui/Icon';
import { FILTER_OPTIONS, emptyMessage, pinState, pinnedCount, visibleSongs, type SongAction, type SongFilter } from './mySongs';
import type { MySongsModel, MySongsState } from './mySongsModel';
import { SongRow } from './SongRow';
import styles from './songs.module.css';

interface MySongsPageProps {
  model: MySongsModel;
  onHistory?: () => void;
  onSeed: (song: TrackMark) => void;
}

function PinStatus({ count }: { count: number }) {
  const full = count >= PINNED_LIMIT;
  return (
    <p id="pin-status" className={styles.pinStatus} data-full={full} data-testid="pin-status">
      <Icon name="pin" size={16} />
      <span>
        釘選 {count}／{PINNED_LIMIT}
        {full ? '・已滿，先取消一首才能再釘' : '・每輪開台都會先帶上'}
      </span>
    </p>
  );
}

interface SongListProps {
  model: MySongsModel;
  state: MySongsState;
  songs: readonly TrackMark[];
  onSeed: (song: TrackMark) => void;
  onAction: (trackKey: string, action: SongAction, on: boolean) => Promise<void>;
}

function SongList({ model, state, songs, onSeed, onAction }: SongListProps) {
  const loadHistory = useCallback((trackKey: string) => void model.loadHistory(trackKey), [model]);
  const listKey = songs.map((song) => song.trackKey).join('\n');
  useEffect(() => () => model.clearDisplay(), [model, listKey]);
  return (
    <ul key={listKey} className={styles.list} aria-label="歌曲清單">
      {songs.map((song) => (
        <SongRow
          key={song.trackKey}
          song={song}
          display={state.display[song.trackKey]}
          onVisible={model.requestDisplay}
          pinFull={pinState(state.songs, song) === 'full'}
          busy={state.pending === song.trackKey}
          disabled={state.pending !== null}
          history={state.history[song.trackKey]}
          onAction={(action, on) => void onAction(song.trackKey, action, on)}
          onSeed={() => onSeed(song)}
          onLoadHistory={() => loadHistory(song.trackKey)}
        />
      ))}
    </ul>
  );
}

function EmptyLibrary() {
  const setTab = useAppStore((s) => s.setTab);
  return (
    <section className={styles.empty} data-testid="songs-empty">
      <h2>還沒有歌</h2>
      <p>聽完一首、留下「愛／還行／不對」，它就會出現在這裡；之後可以收藏、封鎖、釘選，或拿來當種子。</p>
      <Button variant="outline" icon="radio" onClick={() => setTab('home')}>
        去開台
      </Button>
    </section>
  );
}

export function MySongsPage({ model, onSeed, onHistory }: MySongsPageProps) {
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const showToast = useAppStore((s) => s.showToast);
  const announce = useAppStore((s) => s.announce);
  const act = useCallback(
    async (trackKey: string, action: SongAction, on: boolean) => {
      const outcome = await model.act(trackKey, action, on);
      showToast(outcome.message);
      announce(outcome.message);
    },
    [model, showToast, announce],
  );
  const [filter, setFilter] = useState<SongFilter>('all');
  const [query, setQuery] = useState('');
  const searchId = useId();
  useEffect(() => {
    void model.load();
  }, [model]);
  const songs = visibleSongs(state.songs, { filter, query }, state.loadedAt);
  const hasLibrary = state.songs.length > 0;
  const actionError = state.actionError;
  const retryLabel = actionError ? `${actionError.on ? '' : '取消'}${{ love: '收藏', pin: '釘選', block: '封鎖' }[actionError.action]}` : '';

  return (
    <div className={styles.page} data-testid="my-songs">
      <header className={styles.heading}>
        <Eyebrow>YOUR SONGS, REMEMBERED.</Eyebrow>
        <h1>我的歌</h1>
        <p>收藏、封鎖與釘選，下一次開台前都會先讀。</p>
      </header>
      {onHistory && <Button variant="outline" onClick={onHistory}>開台歷史</Button>}
      {state.loadError && (
        <InlineRecovery
          tone="offline"
          title={state.status === 'ready' ? '重新讀取沒有成功' : '暫時讀不到我的歌'}
          testId="songs-error"
          actions={
            <Button variant="outline" block loading={state.loading} disabled={state.pending !== null} onClick={() => void model.load()}>
              重新讀取
            </Button>
          }
        >
          <p>{state.loadError}</p>
          <p>{state.status === 'ready' ? '目前顯示上次讀到的清單，可能已過期。請重新讀取。' : '帳本沒有被更動，稍後再試即可。'}</p>
        </InlineRecovery>
      )}
      {actionError && (
        <InlineRecovery
          tone="error"
          title="這次操作沒有完成"
          testId="songs-action-error"
          actions={
            <Button variant="outline" block disabled={state.pending !== null} onClick={() => void act(actionError.trackKey, actionError.action, actionError.on)}>
              重試{retryLabel}
            </Button>
          }
        >
          <p>〈<span data-song-data>{actionError.title}</span>〉的{retryLabel}沒有完成。</p>
          <p>{actionError.message}</p>
        </InlineRecovery>
      )}
      {(state.status === 'loading' || state.status === 'idle') && <p className={styles.loading} role="status">讀取中…</p>}
      {state.status === 'ready' && !hasLibrary && <EmptyLibrary />}
      {state.status === 'ready' && hasLibrary && (
        <>
          <div className={styles.tools}>
            <label className={styles.search} htmlFor={searchId}>
              <Icon name="search" size={18} />
              <span className="sr-only">搜尋我的歌</span>
              <input
                id={searchId}
                type="search"
                value={query}
                placeholder="搜尋曲名或藝人"
                maxLength={100}
                onChange={(e) => setQuery(e.target.value)}
                data-testid="songs-search"
              />
            </label>
            <SegmentedControl size="sm" label="篩選我的歌" options={FILTER_OPTIONS} value={filter} onChange={setFilter} />
          </div>
          <PinStatus count={pinnedCount(state.songs)} />
          {songs.length > 0 ? (
            <SongList model={model} state={state} songs={songs} onSeed={onSeed} onAction={act} />
          ) : (
            <p className={styles.filterEmpty} role="status" data-testid="songs-filter-empty">
              {emptyMessage(filter, query)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
