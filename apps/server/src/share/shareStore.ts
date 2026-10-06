/**
 * 分享紀錄 store（BRA-129）：本機 JSON 檔（沿用品味帳本的 tmp＋rename、權限 600）。
 * 只存精選集五首與計數，不存種子原文。每次操作重新讀檔驗證；損毀時丟錯且不覆寫。
 */
import { randomBytes } from 'node:crypto';
import {
  MAX_SHARE_RECORDS,
  ShareFileSchema,
  type CreateShareRequest,
  type ShareCounts,
  type ShareEventKind,
  type ShareFile,
  type ShareRecord,
} from '@qualia/contracts';
import type { TastePersistence } from '../ledger/tasteStore.js';

export type SharePersistence = TastePersistence;

export class ShareStoreError extends Error {
  override name = 'ShareStoreError';
  constructor(readonly failure: 'unreadable' | 'corrupt' | 'write') {
    super(`share store ${failure}`);
  }
}

/** 12 字元 base64url（9 bytes 隨機）。 */
export const newShareCode = (): string => randomBytes(9).toString('base64url');

const fingerprint = (request: Pick<ShareRecord, 'selectionNo' | 'tracks'>): string =>
  JSON.stringify([request.selectionNo, request.tracks.map((track) => track.trackKey)]);

export class ShareStore {
  constructor(
    private readonly persistence: SharePersistence,
    private readonly now: () => number,
    private readonly newCode: () => string = newShareCode,
  ) {}

  /** 同一本（同編號、同五首）再分享沿用原短碼，分享次數＋1。 */
  create(request: CreateShareRequest): ShareRecord {
    const file = this.loaded();
    const existing = file.shares.find((record) => fingerprint(record) === fingerprint(request));
    if (existing) return this.bump(file, existing.code, 'shared');
    const known = new Set(file.shares.map((record) => record.code));
    let code = this.newCode();
    while (known.has(code)) code = this.newCode();
    const record: ShareRecord = {
      code,
      selectionNo: request.selectionNo,
      tracks: request.tracks.map((track) => ({ ...track })),
      createdAt: new Date(this.now()).toISOString(),
      counts: { shared: 1, opened: 0, continued: 0 },
    };
    this.save({ version: 1, shares: [...file.shares, record].slice(-MAX_SHARE_RECORDS) });
    return record;
  }

  find(code: string): ShareRecord | undefined {
    return this.loaded().shares.find((record) => record.code === code);
  }

  /** 記一次事件；短碼不存在回 undefined。 */
  record(code: string, kind: ShareEventKind): ShareCounts | undefined {
    const file = this.loaded();
    if (!file.shares.some((record) => record.code === code)) return undefined;
    return this.bump(file, code, kind).counts;
  }

  private bump(file: ShareFile, code: string, kind: keyof ShareCounts): ShareRecord {
    let updated: ShareRecord | undefined;
    const shares = file.shares.map((record) => {
      if (record.code !== code) return record;
      updated = { ...record, counts: { ...record.counts, [kind]: record.counts[kind] + 1 } };
      return updated;
    });
    if (!updated) throw new ShareStoreError('corrupt');
    this.save({ version: 1, shares });
    return updated;
  }

  private save(file: ShareFile): void {
    const body = JSON.stringify(ShareFileSchema.parse(file), null, 2);
    try { this.persistence.save(body); }
    catch { throw new ShareStoreError('write'); }
  }

  private loaded(): ShareFile {
    let body: string | null;
    try { body = this.persistence.load(); }
    catch { throw new ShareStoreError('unreadable'); }
    if (body === null) return { version: 1, shares: [] };
    try { return ShareFileSchema.parse(JSON.parse(body)); }
    catch { throw new ShareStoreError('corrupt'); }
  }
}
