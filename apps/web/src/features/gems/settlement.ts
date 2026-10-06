/**
 * BRA-169 結算翻牌（純函式、不可變）：這趟播完的曲目背面朝上排成牌堆；全部翻開後才可以選 1 首成為寶石。
 * 被按「不對」的歌不進牌堆。只在前端記憶體，不含種子文字。
 */
import { GEM_PALETTE_COUNT, type FeedbackRating } from '@qualia/contracts';
import type { EngineState, QueueItem } from '../../audio/types';

export interface SettleCard {
  readonly segmentId: string;
  readonly showId: string;
  readonly title: string;
  readonly artist: string;
  /** 寶石色＝這首的聲景場景（與收聽頁 ListenArtwork 同一套規則）。 */
  readonly palette: number;
  readonly revealed: boolean;
}

export interface Settlement {
  readonly journeyId: string;
  readonly cards: readonly SettleCard[];
  /** 全部翻開後選定、還沒送出的那張。 */
  readonly picked: string | null;
}

/** segmentId → 這趟留下的評價。 */
export type TripRatings = Readonly<Record<string, FeedbackRating>>;

function paletteOf(item: QueueItem, index: number): number {
  const locator = item.segment.track.audioLocator;
  const palette = locator.kind === 'mock_tone' ? locator.palette : index;
  return ((palette % GEM_PALETTE_COUNT) + GEM_PALETTE_COUNT) % GEM_PALETTE_COUNT;
}

/** 牌堆：狀態是「已播」且沒被按「不對」的曲目，依播放順序。 */
export function settlementCards(state: EngineState, ratings: TripRatings): SettleCard[] {
  return state.queue.flatMap((item, index) => {
    const { segmentId, candidate } = item.segment;
    if (state.statuses[segmentId] !== 'played' || ratings[segmentId] === '不對') return [];
    return [{ segmentId, showId: item.showId, title: candidate.title, artist: candidate.artist, palette: paletteOf(item, index), revealed: false }];
  });
}

export function createSettlement(journeyId: string, cards: readonly SettleCard[]): Settlement {
  return { journeyId, cards, picked: null };
}

/** 翻開一張；已翻開或不在牌堆時原樣回傳（不能蓋回去）。 */
export function revealCard(settlement: Settlement, segmentId: string): Settlement {
  const index = settlement.cards.findIndex((card) => card.segmentId === segmentId);
  const card = settlement.cards[index];
  if (!card || card.revealed) return settlement;
  return { ...settlement, cards: settlement.cards.map((c, i) => (i === index ? { ...card, revealed: true } : c)) };
}

export const allRevealed = (settlement: Settlement): boolean => settlement.cards.length > 0 && settlement.cards.every((card) => card.revealed);

export const canChoose = allRevealed;

export const revealedCount = (settlement: Settlement): number => settlement.cards.filter((card) => card.revealed).length;

/** 選定一張：還有牌沒翻開、或不在牌堆時原樣回傳。 */
export function chooseCard(settlement: Settlement, segmentId: string): Settlement {
  if (!canChoose(settlement) || !settlement.cards.some((card) => card.segmentId === segmentId)) return settlement;
  return settlement.picked === segmentId ? settlement : { ...settlement, picked: segmentId };
}
