/**
 * 五首結算（BRA-169，設計稿 03／05）：夜色全螢幕層蓋在收聽頁上（原生 modal <dialog>，焦點留在層內）。
 * 牌背面朝上 → 一張張翻開 → 全部翻開後才能選 1 首 → 送出成為寶石；第 5 顆接著開出旅程精選集。
 * 上方引用 v1 旅程膠囊（只顯示標籤與結語，「看完整膠囊」開原本的 CapsuleSheet，不重做）。
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { GEMS_PER_SELECTION } from '@qualia/contracts';
import { useAppStore } from '../../app/appStore';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { capsuleFor, type Capsule } from '../journey/journey';
import type { JourneyTracker } from '../journey/journeyTracker';
import { GemIcon } from './GemIcon';
import { pad2 } from './gemCopy';
import { allRevealed, revealedCount, type SettleCard } from './settlement';
import type { GemSettleController, SettleState } from './settleController';
import styles from './gems.module.css';

function CapsuleBrief({ capsule, onOpen }: { capsule: Capsule; onOpen: () => void }) {
  return (
    <section className={styles.capsuleBrief} aria-label="這趟的旅程膠囊">
      <p className={styles.nightKicker}>JOURNEY CAPSULE · NO.{pad2(capsule.id)}</p>
      {capsule.moodTags.length > 0 && (
        <ul className={styles.briefTags}>
          {capsule.moodTags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      )}
      <p className={styles.briefOutro}>{capsule.outro}</p>
      <button type="button" className={styles.linkButton} onClick={onOpen}>
        看完整膠囊
      </button>
    </section>
  );
}

type CardView = 'hidden' | 'revealed' | 'picked' | 'chosen' | 'passed';

function cardView(card: SettleCard, state: SettleState): CardView {
  if (!card.revealed) return 'hidden';
  const picked = state.settlement?.picked === card.segmentId;
  if (state.status === 'chosen') return picked ? 'chosen' : 'passed';
  return picked ? 'picked' : 'revealed';
}

interface CardProps {
  card: SettleCard;
  index: number;
  view: CardView;
  selectable: boolean;
  onReveal: () => void;
  onPick: () => void;
}

function Card({ card, index, view, selectable, onReveal, onPick }: CardProps) {
  if (view === 'hidden') {
    return (
      <button type="button" className={styles.card} data-card-state="hidden" onClick={onReveal} aria-label={`第 ${index + 1} 張牌，背面朝上，翻開`}>
        <span className={styles.cardBack} aria-hidden="true">Q</span>
      </button>
    );
  }
  const face = (
    <span className={styles.cardFace}>
      <GemIcon palette={card.palette} size={view === 'chosen' ? 38 : 28} />
      <strong>{card.title}</strong>
      <small>{card.artist}</small>
    </span>
  );
  if (!selectable) {
    return (
      <div className={styles.card} data-card-state={view === 'chosen' || view === 'passed' ? view : 'revealed'}>
        {face}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={styles.card}
      data-card-state={view === 'picked' ? 'picked' : 'revealed'}
      aria-pressed={view === 'picked'}
      onClick={onPick}
      aria-label={`選〈${card.title}〉`}
    >
      {face}
    </button>
  );
}

function ConfirmArea({ state, onConfirm }: { state: SettleState; onConfirm: () => void }) {
  const settlement = state.settlement!;
  const ready = allRevealed(settlement);
  const picked = settlement.cards.find((card) => card.segmentId === settlement.picked);
  const opened = revealedCount(settlement);
  const label = !ready ? `還有 ${settlement.cards.length - opened} 張沒翻開` : !picked ? '選一首留成寶石' : state.status === 'error' ? '再試一次' : `把〈${picked.title}〉留成寶石`;
  return (
    <div className={styles.confirm}>
      {state.error && (
        <p className={styles.settleError} role="alert" data-testid="settle-error">
          {state.error}
        </p>
      )}
      <p className={styles.settleStatus} role="status">
        {ready ? (picked ? `選了〈${picked.title}〉。` : '全部翻開了，選一首留下。') : `已翻開 ${opened}／${settlement.cards.length} 張`}
      </p>
      <Button block disabled={!ready || !picked} loading={state.status === 'sending'} onClick={onConfirm} data-testid="settle-confirm">
        {label}
      </Button>
    </div>
  );
}

function ChosenArea({ state, onWall }: { state: SettleState; onWall: () => void }) {
  const result = state.result!;
  const unlocked = result.unlocked;
  return (
    <section className={styles.chosen} data-testid="settle-chosen">
      <p className={styles.chosenLine} role="status">
        <GemIcon palette={result.gem.palette} size={30} />
        <span>
          「{result.gem.title}」成為你的第 {result.wall.total} 顆寶石。
        </span>
      </p>
      {unlocked && (
        <section className={styles.unlocked} data-testid="selection-unlocked" aria-labelledby="selection-unlocked-title">
          <p className={styles.nightKicker}>JOURNEY SELECTION · NO.{pad2(unlocked.no)}</p>
          <h3 id="selection-unlocked-title">第 {unlocked.no} 本旅程精選集，開出來了。</h3>
          <p className={styles.unlockedString} aria-hidden="true">
            {unlocked.gems.map((gem) => (
              <GemIcon key={gem.gemId} palette={gem.palette} size={30} />
            ))}
          </p>
          <ol className={styles.unlockedTracks}>
            {unlocked.gems.map((gem) => (
              <li key={gem.gemId}>
                <strong>{gem.title}</strong>
                <small>{gem.artist}</small>
              </li>
            ))}
          </ol>
          <p className={styles.nightNote}>寶石牆會開始第 {unlocked.no + 1} 本（0/{GEMS_PER_SELECTION}），這本收進「歷屆精選集」。</p>
        </section>
      )}
      <Button block trailingIcon="arrow" onClick={onWall} data-testid="settle-to-wall">
        收進寶石牆
      </Button>
    </section>
  );
}

export interface SettlePanelProps {
  state: SettleState;
  capsule: Capsule | null;
  onReveal: (segmentId: string) => void;
  onPick: (segmentId: string) => void;
  onConfirm: () => void;
  onWall: () => void;
  onCapsule: () => void;
}

export function SettlePanel({ state, capsule, onReveal, onPick, onConfirm, onWall, onCapsule }: SettlePanelProps) {
  const settlement = state.settlement;
  if (!settlement) return null;
  const empty = settlement.cards.length === 0;
  const selectable = allRevealed(settlement) && state.status !== 'chosen' && state.status !== 'sending';
  return (
    <div className={styles.settle} data-testid="settle-panel">
      {capsule && <CapsuleBrief capsule={capsule} onOpen={onCapsule} />}
      <h2 id="settle-title" className={styles.settleTitle}>
        翻開每一張，
        <br />
        再把一首留成寶石。
      </h2>
      {empty ? (
        <p className={styles.settleLead}>這趟還沒有聽完的歌。聽完一首才會留下寶石。</p>
      ) : (
        <>
          <p className={styles.settleLead}>這趟聽完的歌都在牌裡，背面朝上。全部翻開後，選一首成為這趟的寶石。</p>
          <ol className={styles.deck} aria-label="這趟的牌">
            {settlement.cards.map((card, index) => (
              <li key={card.segmentId}>
                <Card
                  card={card}
                  index={index}
                  view={cardView(card, state)}
                  selectable={selectable}
                  onReveal={() => onReveal(card.segmentId)}
                  onPick={() => onPick(card.segmentId)}
                />
              </li>
            ))}
          </ol>
          {state.status === 'chosen' && state.result ? <ChosenArea state={state} onWall={onWall} /> : <ConfirmArea state={state} onConfirm={onConfirm} />}
        </>
      )}
      <p className={styles.settleRule}>每趟只留一顆。被你按「不對」的歌不會進牌堆。</p>
    </div>
  );
}

interface SettleOverlayProps {
  controller: GemSettleController;
  journey: JourneyTracker;
  onWall: () => void;
}

/** 只在收聽頁蓋上；關掉（× 或 Esc）不會遺失翻牌進度，節目結束卡可以再打開。 */
export function SettleOverlay({ controller, journey, onWall }: SettleOverlayProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const journeyState = useSyncExternalStore(journey.subscribe, journey.getState, journey.getState);
  const tab = useAppStore((s) => s.tab);
  const openSheet = useAppStore((s) => s.openSheet);
  const ref = useRef<HTMLDialogElement>(null);
  const visible = state.open && state.settlement !== null && tab === 'listen';
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (visible && !dialog.open) dialog.showModal();
    if (!visible && dialog.open) dialog.close();
  }, [visible]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // 只有使用者按 Esc 才算關掉；切到別的 tab 時程式關閉 dialog，回到收聽頁會再蓋上。
    const onCancel = (event: Event) => {
      event.preventDefault();
      controller.close();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => dialog.removeEventListener('cancel', onCancel);
  }, [controller]);
  const capsule = state.settlement ? capsuleFor(journeyState, state.settlement.journeyId) : null;
  return (
    <dialog ref={ref} className={styles.overlay} aria-labelledby="settle-title" data-testid="settle-overlay">
      <div className={styles.overlayTop}>
        <button type="button" className={styles.closeButton} onClick={() => controller.close()} aria-label="先關掉，稍後再翻">
          <Icon name="close" size={22} />
        </button>
        <span className={styles.overlayPill}>這趟結算</span>
      </div>
      {visible && (
        <SettlePanel
          state={state}
          capsule={capsule}
          onReveal={(id) => controller.reveal(id)}
          onPick={(id) => controller.pick(id)}
          onConfirm={() => void controller.confirm()}
          onWall={() => {
            controller.close();
            onWall();
          }}
          onCapsule={() => openSheet('capsule')}
        />
      )}
    </dialog>
  );
}

/** 節目結束卡上的提醒：還沒選 → 回去翻牌；選好了 → 看寶石牆。 */
export function SettleReminder({ controller, onWall }: { controller: GemSettleController; onWall: () => void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  if (!state.settlement || state.settlement.cards.length === 0) return null;
  if (state.status === 'chosen' && state.result) {
    return (
      <Button block variant="outline" onClick={onWall} data-testid="settle-reminder">
        這趟的寶石：〈{state.result.gem.title}〉· 看寶石牆
      </Button>
    );
  }
  return (
    <Button block variant="outline" onClick={() => controller.reopen()} data-testid="settle-reminder">
      有牌還沒翻完，回去留一顆寶石
    </Button>
  );
}
