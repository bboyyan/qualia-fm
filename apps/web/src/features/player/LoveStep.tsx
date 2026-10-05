/**
 * 「愛」→ 確認 sheet → 加入 Qualia Loved → 結果（帳本與 Loved 各自結果）。純呈現＋小容器；
 * 沿用既有 BottomSheet／Button／回饋卡樣式。「繼續」那一下兼作下一段聲音的使用者手勢。
 */
import { useSyncExternalStore } from 'react';
import { BottomSheet } from '../../ui/BottomSheet';
import { Button } from '../../ui/Button';
import type { LoveFlowModel, LoveFlowState } from './loveFlow';
import spotify from '../spotify/spotify.module.css';

export function LoveConfirmContent({ title, playlistId }: { title: string; playlistId: string }) {
  return (
    <>
      <p>這會在<strong>你的 Spotify 帳號</strong>裡，把〈{title}〉加進「Qualia Loved」歌單。因為是寫入你 Spotify 的動作，所以先問你一次。</p>
      <dl className={spotify.facts}>
        <div><dt>歌單</dt><dd>Qualia Loved</dd></div>
        <div><dt>ID</dt><dd>{playlistId}</dd></div>
        <div><dt>重複</dt><dd>已在歌單就不再加入</dd></div>
      </dl>
    </>
  );
}

type ResultState = Extract<LoveFlowState, { stage: 'result' }>;

const RESULT_TITLE: Record<ResultState['loved'], string> = {
  added: '已加入 Qualia Loved',
  already: '已經在 Qualia Loved',
  skipped: '只記在帳本',
  failed: '沒能加入 Qualia Loved',
};

interface LoveResultCardProps {
  title: string;
  state: ResultState;
  ledger: string;
  reason: string;
  nextLabel: string;
  onContinue: () => void;
}

export function LoveResultCard({ title, state, ledger, reason, nextLabel, onContinue }: LoveResultCardProps) {
  return (
    <section className={spotify.result} aria-label="「愛」的結果" data-testid="love-result">
      <h2>{RESULT_TITLE[state.loved]}</h2>
      {state.loved === 'added' && <p>〈{title}〉已在你 Spotify 的 Qualia Loved。</p>}
      {state.loved === 'already' && <p>〈{title}〉原本就在 Qualia Loved，不重複加入。</p>}
      {state.loved === 'skipped' && <p>沒有寫入你的 Spotify。</p>}
      {state.loved === 'failed' && <p role="alert">{state.message} 帳本照常寫入，旅程不會卡住。</p>}
      <ul>
        <li>{ledger}已寫入：愛{reason ? `・${reason}` : ''}</li>
        {state.loved === 'added' && <li>Qualia Loved 新增 1 首（原本沒有，不重複加入）</li>}
      </ul>
      {(state.loved === 'added' || state.loved === 'already') && (
        <a className={spotify.openLink} href={`https://open.spotify.com/playlist/${state.playlistId}`} target="_blank" rel="noopener noreferrer">在 Spotify 開啟 Qualia Loved</a>
      )}
      <Button block onClick={onContinue} data-testid="love-continue">{nextLabel}</Button>
    </section>
  );
}

interface LoveStepProps {
  flow: LoveFlowModel;
  title: string;
  playlistId: string;
  reason: string;
  nextLabel: string;
  onContinue: () => void;
}

export function LoveStep({ flow, title, playlistId, reason, nextLabel, onContinue }: LoveStepProps) {
  const state = useSyncExternalStore(flow.subscribe, flow.getState, flow.getState);
  const ledger = flow.receipt.mode === 'fake' ? 'TEST 假帳本' : '帳本';
  const asking = state.stage === 'confirm' || state.stage === 'adding';
  return (
    <>
      {state.stage === 'result' ? (
        <LoveResultCard title={title} state={state} ledger={ledger} reason={reason} nextLabel={nextLabel} onContinue={onContinue} />
      ) : (
        <p role="status" data-testid="love-pending">{ledger}已記錄「愛」。要不要也加入你的 Qualia Loved？</p>
      )}
      <BottomSheet
        open={asking}
        title="加入你的 Qualia Loved？"
        onClose={() => flow.skip()}
        testId="love-confirm"
        footer={
          <div className={spotify.stageActions}>
            <Button block loading={state.stage === 'adding'} disabled={state.stage === 'adding'} onClick={() => void flow.confirm()} data-testid="love-add">加入 Qualia Loved</Button>
            <Button variant="outline" block disabled={state.stage === 'adding'} onClick={() => flow.skip()} data-testid="love-skip">只在帳本記「愛」，不加入</Button>
          </div>
        }
      >
        <LoveConfirmContent title={title} playlistId={playlistId} />
      </BottomSheet>
    </>
  );
}
