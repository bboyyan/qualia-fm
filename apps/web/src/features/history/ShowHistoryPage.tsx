import { useEffect, useState } from 'react';
import type { ShowSummary } from '@qualia/contracts';
import { api } from '../../app/services';
import { Button } from '../../ui/Button';
import styles from './history.module.css';

const speechLabels = { off: 'DJ 未啟用', mock_chime: '提示音（非 AI 語音）', ai_audio: 'AI 語音', text: '文字介紹' };

export function ShowHistoryPage({ onSongs, onSeed }: { onSongs: () => void; onSeed: (show: ShowSummary) => void }) {
  const [shows, setShows] = useState<ShowSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api.showHistory(controller.signal).then((next) => {
      setShows(next);
      setError(false);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [revision]);
  return (
    <section className={styles.page} aria-labelledby="history-title">
      <header className={styles.heading}>
        <h1 id="history-title">開台歷史</h1>
        <p>依時間回看準備好的每一台；摘要保存在這台服務上。</p>
      </header>
      <Button variant="text" onClick={onSongs}>回我的歌</Button>
      {error ? <div role="alert"><p>暫時讀不到開台歷史，請稍後再試。</p><Button variant="outline" onClick={() => setRevision((value) => value + 1)}>重新讀取</Button></div>
        : shows === null ? <p role="status">讀取中…</p>
        : shows.length === 0 ? <p>還沒有開台紀錄。準備好一台後，它會留在這裡。</p>
        : <ol className={styles.list} aria-label="開台歷史清單">
          {shows.map((show) => <li key={show.showId} data-testid="show-history-row">
            <details className={styles.row}>
              <summary>
                <time dateTime={show.createdAt}>{new Date(show.createdAt).toLocaleString('zh-TW')}</time>
                <h2>{show.seed.text}</h2>
                <p>{show.trackCount} 首・{show.ttsDegraded ? '語音已降級' : '語音未降級'}</p>
              </summary>
              <div className={styles.detail}>
                <p>種子：{ { feeling: '感覺', song: '歌曲', sound: '聲音' }[show.seed.kind]}・{show.seed.text}{show.seed.artist && `・${show.seed.artist}`}</p>
                <p>{speechLabels[show.speech]}{show.ttsDegraded && '・部分或全部語音改為文字介紹＋提示音'}</p>
                <ol data-testid="history-tracks">{show.tracks.map((track, index) => <li key={index}>{track.title}・{track.artist}</li>)}</ol>
                {show.trackCount === 0 && <p>本輪沒有可用曲目。</p>}
                <Button variant="outline" block onClick={() => onSeed(show)}>用這個種子重開</Button>
                <Button variant="text" block onClick={onSongs}>去我的歌</Button>
              </div>
            </details>
          </li>)}
        </ol>}
    </section>
  );
}
