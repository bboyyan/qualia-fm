/**
 * 寶石牆 store（BRA-169）：本機 JSON 檔，寫法比照品味帳本（私有 tmp＋同目錄 rename，檔案 600）。
 * 每次操作重新讀檔驗證；讀不到／損毀丟 GemWallError，且不覆寫損毀檔。只存曲名／藝人／色號／時間，不存種子原文。
 */
import { randomUUID } from 'node:crypto';
import { GEMS_PER_SELECTION, GemWallFileSchema, gemWallOf, type Gem, type GemWall, type Selection } from '@qualia/contracts';
import { AppError } from '../http/errors.js';
import type { TastePersistence } from '../ledger/tasteStore.js';

export type GemWallFailure = 'unreadable' | 'corrupt' | 'write';

export class GemWallError extends Error {
  override name = 'GemWallError';
  constructor(readonly failure: GemWallFailure) {
    super(`gem wall ${failure}`);
  }
}

export interface ChooseInput {
  readonly journeyId: string;
  readonly trackKey: string;
  readonly title: string;
  readonly artist: string;
  readonly palette: number;
}

export interface ChooseOutcome {
  readonly gem: Gem;
  readonly wall: GemWall;
  /** 這次新增的寶石剛好湊滿一本時，解鎖的精選集。冪等重送不再回報。 */
  readonly unlocked: Selection | null;
  readonly created: boolean;
}

const newGemId = (): string => `gem_${randomUUID()}`;

export class GemWallStore {
  constructor(
    private readonly persistence: TastePersistence,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = newGemId,
  ) {}

  wall(): GemWall {
    return gemWallOf(this.loaded());
  }

  /** 一趟只留一顆：同一首重送回原寶石（created=false），換一首回 409；不同趟可以是同一首歌。 */
  choose(input: ChooseInput): ChooseOutcome {
    const gems = this.loaded();
    const existing = gems.find((gem) => gem.journeyId === input.journeyId);
    if (existing) {
      if (existing.trackKey !== input.trackKey) throw new AppError('GEM_ALREADY_CHOSEN');
      return { gem: existing, wall: gemWallOf(gems), unlocked: null, created: false };
    }
    const gem: Gem = { gemId: this.newId(), ...input, chosenAt: new Date(this.now()).toISOString() };
    const next = [...gems, gem];
    const body = GemWallFileSchema.parse({ version: 1, gems: next });
    try { this.persistence.save(JSON.stringify(body, null, 2)); }
    catch { throw new GemWallError('write'); }
    const wall = gemWallOf(next);
    const unlocked = next.length % GEMS_PER_SELECTION === 0 ? (wall.selections.at(-1) ?? null) : null;
    return { gem, wall, unlocked, created: true };
  }

  private loaded(): readonly Gem[] {
    let body: string | null;
    try { body = this.persistence.load(); }
    catch { throw new GemWallError('unreadable'); }
    if (body === null) return [];
    try { return GemWallFileSchema.parse(JSON.parse(body)).gems; }
    catch { throw new GemWallError('corrupt'); }
  }
}
