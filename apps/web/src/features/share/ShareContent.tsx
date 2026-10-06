/**
 * 分享頁內容（BRA-163 幀 06）：夜色分享卡（五首＋ Spotify 單曲連結）、存圖／複製連結／停用的公開連結，
 * 下方「繼續旅程」與「先改一句」。純呈現，狀態與動作由 ShareSheet 傳入。
 */
import { useId } from 'react';
import { continuationSeed } from '@qualia/contracts';
import { Button } from '../../ui/Button';
import { cardLines, GEM_COLORS } from './shareCard';
import type { ShareState } from './shareController';
import styles from './share.module.css';

export interface ShareActions {
  saveImage: () => void;
  copyLink: () => void;
  continueJourney: () => void;
  startEdit: () => void;
  cancelEdit: () => void;
  setDraft: (draft: string) => void;
}

interface ShareContentProps {
  state: ShareState;
  actions: ShareActions;
}

function Gem({ palette }: { palette: number }) {
  return (
    <svg className={styles.gem} viewBox="0 0 100 100" aria-hidden="true" style={{ color: GEM_COLORS[palette % GEM_COLORS.length] }}>
      <polygon points="20,12 80,12 100,38 50,94 0,38" fill="currentColor" />
      <polygon points="20,12 50,12 35,38" fill="#fff" opacity=".42" />
      <polygon points="65,38 100,38 50,94" fill="#000" opacity=".22" />
    </svg>
  );
}

function StatusMessage({ status }: { status: ShareState['status'] }) {
  if (status === 'loading') return <p className={styles.status} role="status">正在打開旅程精選集…</p>;
  if (status === 'missing') return <p className={styles.status} role="status" data-testid="share-missing">找不到這本旅程精選集。連結只在同一個 app、已登入時打得開。</p>;
  return <p className={styles.status} role="alert">暫時打不開分享頁，請稍後再試。</p>;
}

function ShareGrid({ actions }: { actions: ShareActions }) {
  const noteId = useId();
  return (
    <>
      <div className={styles.shareGrid} role="group" aria-label="分享方式">
        <button type="button" className={styles.shareAction} onClick={actions.saveImage} data-testid="share-save-image">
          <span className={styles.ring} aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm-2 13 5-5 4 4 3-3 6 6M15.5 8.5v.1" /></svg>
          </span>
          存成圖片
        </button>
        <button type="button" className={styles.shareAction} onClick={actions.copyLink} data-testid="share-copy-link">
          <span className={styles.ring} aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" /></svg>
          </span>
          複製連結
        </button>
        <button type="button" className={styles.shareAction} disabled data-testid="share-public-link" aria-describedby={noteId}>
          <span className={styles.ring} aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18ZM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></svg>
          </span>
          公開連結
          <small id={noteId}>公開分享尚未開放</small>
        </button>
      </div>
      <p className={styles.scope}>複製的連結只在這個 app 內、已登入時打得開；種子可能是私事，卡片上不放。</p>
    </>
  );
}

function ContinueSection({ state, actions }: ShareContentProps) {
  const view = state.view!;
  const inputId = useId();
  const problemId = useId();
  const seeds = continuationSeed(view.tracks).text.split('／');
  return (
    <section className={styles.continue} aria-labelledby={`${inputId}-title`} data-testid="share-continue-section">
      <h3 id={`${inputId}-title`}>繼續旅程</h3>
      <p>用這五首當種子，開下一趟五首。</p>
      <ul className={styles.seeds} aria-label="種子：精選集五首">
        {seeds.map((title, index) => <li key={`${index}-${title}`}>{title}</li>)}
      </ul>
      {state.editing ? (
        <div className={styles.edit}>
          <label htmlFor={inputId}>先改一句</label>
          <textarea
            id={inputId}
            className={styles.input}
            value={state.draft}
            rows={3}
            onChange={(event) => actions.setDraft(event.target.value)}
            aria-invalid={state.problem ? true : undefined}
            aria-describedby={state.problem ? problemId : undefined}
            data-testid="share-edit-input"
          />
          {state.problem && <p id={problemId} className={styles.problem} role="alert">{state.problem}</p>}
          <Button block onClick={actions.continueJourney} data-testid="share-edit-submit">用這句開台</Button>
          <Button variant="text" block onClick={actions.cancelEdit}>不改了</Button>
        </div>
      ) : (
        <>
          <Button block trailingIcon="arrow" onClick={actions.continueJourney} data-testid="share-continue">繼續旅程</Button>
          <Button variant="text" block onClick={actions.startEdit} data-testid="share-edit">先改一句</Button>
        </>
      )}
      <p className={styles.note}>進入現有開台流程：生成 → 準備好（仍可勾選調整）→ 收聽。</p>
    </section>
  );
}

export function ShareContent({ state, actions }: ShareContentProps) {
  const view = state.view;
  if (state.status !== 'ready' || !view) return <StatusMessage status={state.status} />;
  const lines = cardLines(view);
  return (
    <div className={styles.share} data-testid="share-content">
      <article className={`${styles.card} ${styles.night}`} aria-label="分享卡預覽" data-testid="share-card">
        <p className={styles.kicker}>{lines.kicker}</p>
        <h3 className={styles.cardTitle}>{lines.title}</h3>
        <p className={styles.meta}>{lines.meta}</p>
        <ol className={styles.tracks} data-testid="share-tracks">
          {view.tracks.map((track) => (
            <li key={track.trackKey}>
              <Gem palette={track.palette} />
              <span className={styles.trackText}>
                <span className={styles.trackTitle}>{track.title}</span>
                <small>{track.artist}</small>
              </span>
              <a className={styles.spotify} href={track.spotifyUrl} target="_blank" rel="noopener noreferrer" aria-label={`在 Spotify 找〈${track.title}〉`}>
                Spotify
              </a>
            </li>
          ))}
        </ol>
        <footer className={styles.cardFooter}><b>{lines.footer}</b><span>旅程精選集</span></footer>
      </article>
      <ShareGrid actions={actions} />
      <p className={styles.or}>或者，接著走</p>
      <ContinueSection state={state} actions={actions} />
    </div>
  );
}
