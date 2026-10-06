import { ShowHistoryFileSchema, ShowSummarySchema, PROVIDER_NOTICES, type ShowPlan, type ShowSummary } from '@qualia/contracts';
import { AppError } from '../http/errors.js';
import type { TastePersistence } from './tasteStore.js';

export class ShowHistoryError extends AppError {
  constructor(message: string) { super('INTERNAL', { message }); }
}

/** 同品味帳本：每次重新驗檔、損毀不覆寫；單程序寫入。 */
export class ShowHistory {
  constructor(private readonly persistence: TastePersistence) {}

  list(): ShowSummary[] {
    try {
      const body = this.persistence.load();
      return body === null ? [] : ShowHistoryFileSchema.parse(JSON.parse(body)).shows
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      throw new ShowHistoryError('開台歷史目前無法讀取，請稍後再試。');
    }
  }

  record(plan: ShowPlan, djEnabled: boolean): void {
    const shows = this.list();
    if (shows.some((show) => show.showId === plan.showId)) return;
    const ttsDegraded = djEnabled && plan.warnings.some((warning) =>
      [PROVIDER_NOTICES.tts, PROVIDER_NOTICES.ttsQuotaDaily, PROVIDER_NOTICES.ttsQuotaTotal].some((prefix) => warning.startsWith(prefix)));
    const summary = ShowSummarySchema.parse({
      showId: plan.showId, createdAt: plan.createdAt, seed: plan.seed,
      trackCount: plan.segments.length,
      tracks: plan.segments.map(({ candidate }) => ({ title: candidate.title, artist: candidate.artist })),
      ttsDegraded,
      speech: !djEnabled ? 'off' : plan.segments.some((segment) => segment.speech.kind === 'ai_audio') ? 'ai_audio'
        : ttsDegraded ? 'text' : plan.segments.some((segment) => segment.speech.kind === 'mock_chime') ? 'mock_chime' : 'text',
    });
    try { this.persistence.save(JSON.stringify({ version: 1, shows: [...shows, summary] }, null, 2)); }
    catch { throw new ShowHistoryError('開台歷史寫入失敗，本輪未完成，請稍後再試。'); }
  }
}
