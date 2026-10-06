/**
 * 寶石牆（BRA-169，設計稿 04）：進行中這本的 5 個寶座＋大數字、收藏數、這本的寶石、歷屆旅程精選集。
 * 不顯示種子原文（伺服器也沒有存）；寶石只寫曲名、藝人、第幾趟與日期。
 */
import { useEffect, useSyncExternalStore } from 'react';
import { GEMS_PER_SELECTION, type Gem, type GemWall, type Selection } from '@qualia/contracts';
import { Button } from '../../ui/Button';
import { Eyebrow, InlineRecovery } from '../../ui/Feedback';
import { GemIcon } from './GemIcon';
import { dateLabel, pad2, progressLine, selectionLabel } from './gemCopy';
import type { GemWallModel } from './gemWallModel';
import styles from './gems.module.css';

/** 全部寶石裡的第幾趟（從 1 起算）。 */
const tripOf = (bookNo: number, index: number): number => (bookNo - 1) * GEMS_PER_SELECTION + index + 1;

function Throne({ wall }: { wall: GemWall }) {
  const { no, gems } = wall.current;
  const count = gems.length;
  return (
    <section className={styles.night} data-testid="gem-wall-progress" aria-label={`${selectionLabel(no)}，已收 ${count}／${GEMS_PER_SELECTION} 顆`}>
      <p className={styles.nightKicker}>
        <span>JOURNEY SELECTION · NO.{pad2(no)}</span>
        <span className={styles.live}>進行中</span>
      </p>
      <ol className={styles.throne} aria-hidden="true">
        {Array.from({ length: GEMS_PER_SELECTION }, (_, i) => {
          const gem = gems[i];
          return (
            <li key={i} data-state={gem ? 'filled' : i === count ? 'next' : 'empty'}>
              {gem ? <GemIcon palette={gem.palette} size={40} /> : <GemIcon empty size={40} />}
              <small>{gem ? `第 ${tripOf(no, i)} 趟` : i === count ? '下一顆' : ''}</small>
            </li>
          );
        })}
      </ol>
      <p className={styles.bigCount}>{`${count} / ${GEMS_PER_SELECTION}`}</p>
      <p className={styles.nightLine}>{progressLine(wall)}</p>
      <div className={styles.bar} aria-hidden="true">
        <span style={{ transform: `scaleX(${count / GEMS_PER_SELECTION})` }} />
      </div>
    </section>
  );
}

function GemRow({ gem, trip }: { gem: Gem; trip: number }) {
  return (
    <li className={styles.gemRow}>
      <GemIcon palette={gem.palette} size={30} />
      <span className={styles.gemText}>
        <strong>{gem.title}</strong>
        <small>
          {gem.artist} · 第 {trip} 趟 · {dateLabel(gem.chosenAt)}
        </small>
      </span>
    </li>
  );
}

function Shelf({ selections }: { selections: readonly Selection[] }) {
  return (
    <section className={styles.block} aria-labelledby="gem-shelf-title" data-testid="gem-shelf">
      <h2 id="gem-shelf-title" className={styles.blockTitle}>
        歷屆精選集 <span>{selections.length} 本</span>
      </h2>
      <ol className={styles.shelf}>
        {[...selections].reverse().map((selection) => (
          <li key={selection.no} className={styles.book}>
            <p className={styles.bookHead}>
              <strong>{selectionLabel(selection.no)}</strong>
              <small>
                {dateLabel(selection.gems[0]!.chosenAt)} – {dateLabel(selection.gems.at(-1)!.chosenAt)} · {GEMS_PER_SELECTION} 趟
              </small>
            </p>
            <ol className={styles.bookTracks}>
              {selection.gems.map((gem) => (
                <li key={gem.gemId}>
                  <GemIcon palette={gem.palette} size={18} />
                  <span>{gem.title}</span>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </section>
  );
}

interface GemWallViewProps {
  wall: GemWall;
  onStart: () => void;
}

export function GemWallView({ wall, onStart }: GemWallViewProps) {
  const { no, gems } = wall.current;
  return (
    <>
      <Throne wall={wall} />
      <dl className={styles.stats}>
        <div>
          <dt>已收寶石</dt>
          <dd>{wall.total}</dd>
        </div>
        <div>
          <dt>旅程精選集</dt>
          <dd>{wall.selections.length}</dd>
        </div>
      </dl>
      {wall.total === 0 ? (
        <section className={styles.empty} data-testid="gem-wall-empty">
          <p>{progressLine(wall)}</p>
          <p>每趟五首聽完，翻開所有牌，挑一首留下。</p>
          <Button variant="outline" icon="radio" onClick={onStart}>
            去開台
          </Button>
        </section>
      ) : (
        <section className={styles.block} aria-labelledby="gem-current-title">
          <h2 id="gem-current-title" className={styles.blockTitle}>
            這本的寶石 <span>{`${gems.length} / ${GEMS_PER_SELECTION}`}</span>
          </h2>
          {gems.length > 0 ? (
            <ol className={styles.gemList} data-testid="gem-list">
              {gems.map((gem, i) => (
                <GemRow key={gem.gemId} gem={gem} trip={tripOf(no, i)} />
              ))}
            </ol>
          ) : (
            <p className={styles.quiet}>新的一本從這裡開始，等你下一趟。</p>
          )}
        </section>
      )}
      {wall.selections.length > 0 && <Shelf selections={wall.selections} />}
    </>
  );
}

interface GemWallPageProps {
  model: GemWallModel;
  onStart: () => void;
}

export function GemWallPage({ model, onStart }: GemWallPageProps) {
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  useEffect(() => {
    void model.load();
  }, [model]);
  return (
    <div className={styles.page} data-testid="gem-wall">
      <header className={styles.heading}>
        <Eyebrow>GEM WALL</Eyebrow>
        <h1>寶石牆</h1>
        <p>每趟留下一首。五顆，串成一本旅程精選集。</p>
      </header>
      {state.error && (
        <InlineRecovery
          tone="offline"
          title={state.wall ? '重新讀取沒有成功' : '暫時讀不到寶石牆'}
          testId="gem-wall-error"
          actions={
            <Button variant="outline" block onClick={() => void model.load()}>
              重新讀取
            </Button>
          }
        >
          <p>{state.error}</p>
        </InlineRecovery>
      )}
      {state.status === 'loading' && <p className={styles.quiet} role="status">讀取中…</p>}
      {state.wall && <GemWallView wall={state.wall} onStart={onStart} />}
    </div>
  );
}
