/**
 * 把播放引擎接到結算翻牌（BRA-169）：一趟（引擎的一次 loadShow）播完 → 開出牌堆並打開結算層；
 * 全部翻開＋選定後才送出 POST /api/gems。同一趟只開一次、只送成功一次；新的一趟換新牌堆。
 */
import type { ChooseGemResponse, FeedbackRating } from '@qualia/contracts';
import { ApiError, type ApiClient } from '../../api/client';
import type { EngineState } from '../../audio/types';
import { canChoose, chooseCard, createSettlement, revealCard, settlementCards, type Settlement, type TripRatings } from './settlement';

export type SettleApi = Pick<ApiClient, 'chooseGem'>;

export interface SettleState {
  readonly settlement: Settlement | null;
  /** 結算層是否蓋在收聽頁上；關掉不影響翻牌進度。 */
  readonly open: boolean;
  readonly status: 'idle' | 'sending' | 'chosen' | 'error';
  readonly result: ChooseGemResponse | null;
  readonly error: string | null;
}

const IDLE: SettleState = { settlement: null, open: false, status: 'idle', result: null, error: null };
const CHOOSE_FAILED = '這顆寶石沒有收進寶石牆，請再試一次。';

export class GemSettleController {
  private state: SettleState = IDLE;
  private journeyId: string | null = null;
  private ratings: TripRatings = {};
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly api: SettleApi,
    private readonly onChosen?: (result: ChooseGemResponse) => void,
  ) {}

  getState = (): SettleState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  observe(engine: EngineState): void {
    const { sessionId } = engine;
    if (!sessionId) return;
    if (sessionId !== this.journeyId) this.startJourney(sessionId);
    if (engine.phase !== 'completed' || this.state.settlement) return;
    this.update({ settlement: createSettlement(sessionId, settlementCards(engine, this.ratings)), open: true });
  }

  /**
   * 只接受目前這趟的回饋；旅程只能由 observe 隨引擎切換，舊回應不可重設新結算。
   * 尚未 observe 也忽略：services 在 loadShow 通知時已觀察旅程，早於 FeedbackStep 出現。
   */
  recordRating(sessionId: string | null, segmentId: string, rating: FeedbackRating): void {
    if (!sessionId || sessionId !== this.journeyId) return;
    this.ratings = { ...this.ratings, [segmentId]: rating };
  }

  reveal(segmentId: string): void {
    this.withSettlement((settlement) => revealCard(settlement, segmentId));
  }

  pick(segmentId: string): void {
    if (this.state.status === 'chosen' || this.state.status === 'sending') return;
    this.withSettlement((settlement) => chooseCard(settlement, segmentId));
  }

  async confirm(): Promise<void> {
    const { settlement, status } = this.state;
    if (!settlement?.picked || !canChoose(settlement) || status === 'sending' || status === 'chosen') return;
    const card = settlement.cards.find((item) => item.segmentId === settlement.picked);
    if (!card) return;
    this.update({ status: 'sending', error: null });
    try {
      const result = await this.api.chooseGem({ journeyId: settlement.journeyId, showId: card.showId, segmentId: card.segmentId, palette: card.palette });
      if (this.state.settlement?.journeyId !== settlement.journeyId) return;
      this.update({ status: 'chosen', result });
      this.onChosen?.(result);
    } catch (error) {
      if (this.state.settlement?.journeyId !== settlement.journeyId) return;
      this.update({ status: 'error', error: error instanceof ApiError ? error.message : CHOOSE_FAILED });
    }
  }

  close(): void {
    if (this.state.open) this.update({ open: false });
  }

  reopen(): void {
    if (this.state.settlement && !this.state.open) this.update({ open: true });
  }

  private startJourney(sessionId: string): void {
    this.journeyId = sessionId;
    this.ratings = {};
    if (this.state !== IDLE) this.update(IDLE);
  }

  private withSettlement(change: (settlement: Settlement) => Settlement): void {
    const current = this.state.settlement;
    if (!current) return;
    const next = change(current);
    if (next !== current) this.update({ settlement: next });
  }

  private update(patch: Partial<SettleState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
