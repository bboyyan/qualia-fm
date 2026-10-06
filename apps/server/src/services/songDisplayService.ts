/** 只在請求生命週期持有展示資料；不存圖片、不寫帳本、不呼叫 planner。 */
import { SongDisplayMetadataSchema, trackKeyOf, type SongDisplay } from '@qualia/contracts';
import { AppError } from '../http/errors.js';
import type { SpotifyCatalogResolver } from '../spotify/resolver.js';
import type { JobStore } from '../stores/jobStore.js';
import type { TasteService } from './tasteService.js';

export class SongDisplayService {
  private readonly pending = new Set<AbortController>();
  private retryAt = 0;

  constructor(
    private readonly taste: Pick<TasteService, 'marks'>,
    private readonly store: Pick<JobStore, 'ownedShows'>,
    private readonly resolver: Pick<SpotifyCatalogResolver, 'resolve'> | undefined,
    private readonly now: () => number,
  ) {}

  clear(): void {
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
    this.retryAt = 0;
  }

  async get(keys: readonly string[], ownerId: string, allowed: () => boolean, signal: AbortSignal): Promise<SongDisplay[]> {
    const unavailable = (): SongDisplay[] => keys.map((trackKey) => ({ trackKey, status: 'unavailable' }));
    if (!allowed() || !this.resolver) return unavailable();
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    this.pending.add(controller);
    try {
      const marks = await this.taste.marks();
      const segments = this.store.ownedShows(ownerId).flatMap((show) => show.segments);
      const items: SongDisplay[] = [];
      for (const trackKey of keys) {
        if (!allowed() || controller.signal.aborted) return unavailable();
        combined.throwIfAborted();
        const mark = marks.find((song) => song.trackKey === trackKey);
        if (!mark) {
          items.push({ trackKey, status: 'unavailable' });
          continue;
        }
        let track = segments.find((segment) => trackKeyOf(segment.candidate.artist, segment.candidate.title) === trackKey && segment.track.provider === 'spotify' && segment.track.availability === 'resolved')?.track;
        if (!track) {
          if (this.retryAt > this.now()) throw new AppError('RATE_LIMITED', { retryAfterMs: this.retryAt - this.now() });
          track = await this.resolver.resolve(mark, { signal: combined, scenario: 'five', index: 0 });
        }
        items.push(track.availability === 'resolved'
          ? { trackKey, status: 'available', metadata: SongDisplayMetadataSchema.strip().parse(track) }
          : { trackKey, status: 'unavailable' });
      }
      return allowed() && !controller.signal.aborted ? items : unavailable();
    } catch (error) {
      if (!allowed() || controller.signal.aborted) return unavailable();
      if (error instanceof AppError && error.code === 'RATE_LIMITED') this.retryAt = this.now() + (error.retryAfterMs ?? 5000);
      throw error;
    } finally {
      this.pending.delete(controller);
    }
  }
}
