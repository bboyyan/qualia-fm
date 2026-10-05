/**
 * 品味帳本的讀寫入口（BRA-134）。開台前讀快照、節目排定後寫播出紀錄、聽完回饋與手動改評價／標記都寫同一本帳。
 * 失敗一律明示：開台時回傳 warning（本輪不套規則／未存紀錄），API 寫入失敗回錯誤，絕不吞掉。
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  PINNED_LIMIT,
  TASTE_HISTORY_LIMIT,
  trackKeyOf,
  type FeedbackRating,
  type LedgerEntry,
  type ShowPlan,
  type TasteEditRequest,
  type TrackMark,
} from '@qualia/contracts';
import { AppError } from '../http/errors.js';
import { logger } from '../http/log.js';
import { TasteLedgerError, type TasteLedger, type TasteSnapshot } from '../ledger/tasteStore.js';

export const TASTE_READ_WARNING = '品味帳本讀取失敗：本輪未套用封鎖、近期已播、釘選與評價規則。';
export const TASTE_AIRED_WARNING = '品味帳本寫入失敗：本輪播出紀錄沒有存下，之後可能重播。';
const TASTE_WRITE_MESSAGE = '品味帳本寫入失敗，這次的評價或標記沒有記下，請再試一次。';
const TASTE_UNREADABLE_MESSAGE = '品味帳本目前無法讀取，請稍後再試。';
const PIN_LIMIT_MESSAGE = `釘選已滿 ${PINNED_LIMIT} 首（每輪開台都會帶上），先取消一首再釘。`;

export interface TrackRef {
  readonly title: string;
  readonly artist: string;
}

/** 手動編輯的對象：節目段落（伺服器查出曲名）或帳本裡已有的 trackKey。 */
export type TasteTarget = TrackRef | { readonly trackKey: string };

export interface TasteRead {
  /** null＝帳本讀不到，本輪不套規則。 */
  readonly snapshot: TasteSnapshot | null;
  readonly warning: string | null;
}

const digest = (parts: readonly unknown[]): string => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);

function failureOf(error: unknown): string {
  return error instanceof TasteLedgerError ? error.failure : 'unknown';
}

export class TasteService {
  /** 同一伺服器的手動編輯依序執行，名額檢查到寫入之間不能插入另一筆釘選。 */
  private edits: Promise<void> = Promise.resolve();

  constructor(private readonly ledger: TasteLedger, private readonly now: () => number) {}

  /** 開台前必讀；失敗不擋開台，但回傳明示 warning 並記錄錯誤。 */
  async readForPlan(): Promise<TasteRead> {
    try {
      return { snapshot: await this.ledger.snapshot(), warning: null };
    } catch (error) {
      logger.error('taste_ledger_read_failed', { failure: failureOf(error) });
      return { snapshot: null, warning: TASTE_READ_WARNING };
    }
  }

  /** 真實提名排進節目的曲目記為已播；回傳失敗時要加到節目的 warning。 */
  async recordAired(plan: ShowPlan): Promise<string | null> {
    const at = this.isoNow();
    const entries: LedgerEntry[] = plan.segments.map((segment, index) => ({
      kind: 'aired',
      entryId: `air_${digest([plan.showId, index])}`,
      at,
      ...this.trackFields(segment.candidate),
      showId: plan.showId,
    }));
    try {
      await this.ledger.record(entries);
      return null;
    } catch (error) {
      logger.error('taste_ledger_aired_failed', { failure: failureOf(error) });
      return TASTE_AIRED_WARNING;
    }
  }

  /** 聽完回饋（BRA-98）：同一意圖（show＋segment＋clientRequestId）只記一筆。 */
  async recordFeedback(input: { showId: string; segmentId: string; clientRequestId: string | null; track: TrackRef; rating: FeedbackRating; reason: string }): Promise<void> {
    await this.write([{
      kind: 'feedback',
      entryId: `fb_${digest([input.showId, input.segmentId, input.clientRequestId])}`,
      at: this.isoNow(),
      ...this.trackFields(input.track),
      showId: input.showId,
      rating: input.rating,
      note: input.reason,
    }]);
  }

  /** 手動改評價／標記；回傳更新後的 TrackMark。 */
  edit(target: TasteTarget, request: Omit<TasteEditRequest, 'target'>): Promise<TrackMark> {
    const result = this.edits.then(() => this.editSerially(target, request));
    // 錯誤仍交給這次呼叫者；佇列恢復，後續取消／重試不會被前一筆失敗堵住。
    this.edits = result.then(() => undefined, () => undefined);
    return result;
  }

  private async editSerially(target: TasteTarget, request: Omit<TasteEditRequest, 'target'>): Promise<TrackMark> {
    const track = await this.resolve(target);
    const fields = this.trackFields(track);
    if (request.mark === 'pinned') await this.assertPinRoom(fields.trackKey);
    const idFor = (kind: string): string => request.clientRequestId
      ? `man_${digest([fields.trackKey, kind, request.clientRequestId])}`
      : `man_${randomBytes(12).toString('hex')}`;
    const at = this.isoNow();
    const entries: LedgerEntry[] = [];
    if (request.rating !== undefined) entries.push({ kind: 'rating', entryId: idFor('rating'), at, ...fields, rating: request.rating, note: request.note ?? '' });
    if (request.mark !== undefined) entries.push({ kind: 'mark', entryId: idFor('mark'), at, ...fields, mark: request.mark });
    await this.write(entries);
    const mark = await this.read(() => this.ledger.find(fields.trackKey));
    if (!mark) throw new AppError('INTERNAL', { message: TASTE_WRITE_MESSAGE });
    return mark;
  }

  /** 機器可讀清單：最近更新的在前。 */
  async marks(): Promise<TrackMark[]> {
    const marks = await this.read(() => this.ledger.marks());
    return marks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** 單曲最近幾筆帳本紀錄（新到舊）；不在帳本裡的 trackKey 回 NOT_FOUND。 */
  async history(trackKey: string): Promise<LedgerEntry[]> {
    const entries = await this.read(() => this.ledger.history(trackKey, TASTE_HISTORY_LIMIT));
    if (entries.length === 0) throw new AppError('NOT_FOUND');
    return entries;
  }

  /** 新增釘選時檢查上限；已釘選的再送一次不算新增。上限前的舊帳本（超過上限）照常讀，只擋新增。 */
  private async assertPinRoom(trackKey: string): Promise<void> {
    const marks = await this.read(() => this.ledger.marks());
    if (marks.some((mark) => mark.trackKey === trackKey && mark.mark === 'pinned')) return;
    if (marks.filter((mark) => mark.mark === 'pinned').length >= PINNED_LIMIT) throw new AppError('PIN_LIMIT_REACHED', { message: PIN_LIMIT_MESSAGE });
  }

  private async resolve(target: TasteTarget): Promise<TrackRef> {
    if (!('trackKey' in target)) return target;
    const existing = await this.read(() => this.ledger.find(target.trackKey));
    if (!existing) throw new AppError('NOT_FOUND');
    return existing;
  }

  private trackFields(track: TrackRef): { trackKey: string; title: string; artist: string } {
    return { trackKey: trackKeyOf(track.artist, track.title), title: track.title, artist: track.artist };
  }

  private isoNow(): string {
    return new Date(this.now()).toISOString();
  }

  private async read<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (error) {
      logger.error('taste_ledger_read_failed', { failure: failureOf(error) });
      throw new AppError('INTERNAL', { message: TASTE_UNREADABLE_MESSAGE });
    }
  }

  private async write(entries: readonly LedgerEntry[]): Promise<void> {
    try {
      await this.ledger.record(entries);
    } catch (error) {
      logger.error('taste_ledger_write_failed', { failure: failureOf(error) });
      throw new AppError('INTERNAL', { message: error instanceof TasteLedgerError && error.failure !== 'write' ? TASTE_UNREADABLE_MESSAGE : TASTE_WRITE_MESSAGE });
    }
  }
}
