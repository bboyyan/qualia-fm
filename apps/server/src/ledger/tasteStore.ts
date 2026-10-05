/**
 * 品味帳本 store（BRA-134）：本機 JSON 檔為唯一事實來源，開台前直接讀，不依賴 Notion。
 * 讀不到／損毀一律丟 TasteLedgerError（由呼叫端明示降級），且不覆寫損毀檔；寫入成功後才更新記憶體。
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { TasteLedgerFileSchema, type LedgerEntry, type TasteLedgerFile, type TrackMark } from '@qualia/contracts';

/** 播出紀錄只保留最近這麼多筆（近 N 已播用不到更舊的）；評價與標記永遠保留。 */
export const MAX_AIRED_ENTRIES = 500;

export type TasteLedgerFailure = 'unreadable' | 'corrupt' | 'write';

export class TasteLedgerError extends Error {
  override name = 'TasteLedgerError';
  constructor(readonly failure: TasteLedgerFailure) {
    super(`taste ledger ${failure}`);
  }
}

export interface TasteSnapshot {
  readonly marks: readonly TrackMark[];
  /** 播出過的 trackKey，新到舊、不重複。 */
  readonly recentAired: readonly string[];
}

/** 儲存後端：null＝檔案不存在（首次使用）。 */
export interface TastePersistence {
  load(): string | null;
  save(body: string): void;
}

export function filePersistence(path: string): TastePersistence {
  return {
    load: () => {
      try { return readFileSync(path, 'utf8'); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    /** 私有 tmp（mode 600、wx）＋同目錄 rename；新目錄 mode 700。 */
    save: (body) => {
      const temporary = `${path}.${randomUUID()}.tmp`;
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(temporary, body, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, path);
    },
  };
}

/** 測試與未設定路徑時使用：重啟即消失。 */
export function memoryPersistence(): TastePersistence {
  let body: string | null = null;
  return { load: () => body, save: (next) => { body = next; } };
}

const nullIfEmpty = (value: string): string | null => (value.trim() === '' ? null : value);

/** 依時間順序把事件折成每首歌的目前狀態；後到的評價／標記覆蓋先前的。 */
export function reduceMarks(entries: readonly LedgerEntry[]): TrackMark[] {
  const marks = new Map<string, TrackMark>();
  for (const entry of entries) {
    const previous = marks.get(entry.trackKey) ?? {
      trackKey: entry.trackKey, title: entry.title, artist: entry.artist,
      mark: null, rating: null, note: null, lastAiredAt: null, updatedAt: entry.at,
    };
    const base = { ...previous, title: entry.title, artist: entry.artist, updatedAt: entry.at };
    switch (entry.kind) {
      case 'feedback':
      case 'rating':
        marks.set(entry.trackKey, { ...base, rating: entry.rating, note: nullIfEmpty(entry.note) });
        break;
      case 'mark':
        marks.set(entry.trackKey, { ...base, mark: entry.mark });
        break;
      case 'aired':
        marks.set(entry.trackKey, { ...previous, lastAiredAt: entry.at });
        break;
    }
  }
  return [...marks.values()];
}

function recentAiredOf(entries: readonly LedgerEntry[]): string[] {
  const seen = new Set<string>();
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]!;
    if (entry.kind === 'aired') seen.add(entry.trackKey);
  }
  return [...seen];
}

/** 超出上限時丟掉最舊的播出紀錄，其他事件不動。 */
function trimAired(entries: readonly LedgerEntry[]): LedgerEntry[] {
  const airedCount = entries.filter((entry) => entry.kind === 'aired').length;
  let drop = airedCount - MAX_AIRED_ENTRIES;
  if (drop <= 0) return [...entries];
  return entries.filter((entry) => {
    if (entry.kind !== 'aired' || drop <= 0) return true;
    drop -= 1;
    return false;
  });
}

const byTime = (a: LedgerEntry, b: LedgerEntry): number => a.at.localeCompare(b.at);

export class TasteLedger {
  private state: TasteLedgerFile | null = null;

  constructor(private readonly persistence: TastePersistence) {}

  async snapshot(): Promise<TasteSnapshot> {
    const state = this.loaded();
    return { marks: state.marks.map((mark) => ({ ...mark })), recentAired: recentAiredOf(state.entries) };
  }

  async marks(): Promise<TrackMark[]> {
    return this.loaded().marks.map((mark) => ({ ...mark }));
  }

  async find(trackKey: string): Promise<TrackMark | undefined> {
    const mark = this.loaded().marks.find((item) => item.trackKey === trackKey);
    return mark ? { ...mark } : undefined;
  }

  /** 冪等：已存在的 entryId 略過。全部寫入成功才回傳。 */
  async record(entries: readonly LedgerEntry[]): Promise<void> {
    const state = this.loaded();
    const known = new Set(state.entries.map((entry) => entry.entryId));
    const fresh: LedgerEntry[] = [];
    for (const entry of entries) {
      if (known.has(entry.entryId)) continue;
      known.add(entry.entryId);
      fresh.push(entry);
    }
    if (fresh.length === 0) return;
    const merged = trimAired([...state.entries, ...fresh].sort(byTime));
    const next = TasteLedgerFileSchema.parse({ version: 1, entries: merged, marks: reduceMarks(merged) });
    try { this.persistence.save(JSON.stringify(next, null, 2)); }
    catch { throw new TasteLedgerError('write'); }
    this.state = next;
  }

  /** 每次失敗都會在下次呼叫重試讀檔（人工修好檔案後不必重啟）；損毀檔絕不覆寫。 */
  private loaded(): TasteLedgerFile {
    if (this.state) return this.state;
    let body: string | null;
    try { body = this.persistence.load(); }
    catch { throw new TasteLedgerError('unreadable'); }
    if (body === null) {
      this.state = { version: 1, entries: [], marks: [] };
      return this.state;
    }
    let parsed: TasteLedgerFile;
    try { parsed = TasteLedgerFileSchema.parse(JSON.parse(body)); }
    catch { throw new TasteLedgerError('corrupt'); }
    const entries = [...parsed.entries].sort(byTime);
    this.state = { version: 1, entries, marks: reduceMarks(entries) };
    return this.state;
  }
}
