/**
 * Spotify refresh token 本機小檔（無資料庫）。AES-256-GCM 加密、檔案權限 600、原子寫入。
 * 缺金鑰或金鑰長度錯誤一律 fail closed：不寫檔、讀取視為未連結。access token 只在記憶體，不落地。
 * 擁有者（BRA-111 A1）：只存擁有者憑證的 SHA-256 雜湊；沒有雜湊的舊檔視為未連結（需重新連結）。
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const FILE_MODE = 0o600;
const AAD = Buffer.from('qualia-fm/spotify-token/v1');

export interface StoredSpotifyToken {
  readonly refreshToken: string;
  readonly scope: string;
  /** 擁有者憑證的 SHA-256（base64url）；憑證本身只在擁有者瀏覽器的 HttpOnly cookie。 */
  readonly ownerHash: string;
}

export const OWNER_HASH = /^[A-Za-z0-9_-]{43}$/;

const EnvelopeSchema = z.strictObject({ v: z.literal(1), iv: z.string(), tag: z.string(), data: z.string() });
const PlainSchema = z.strictObject({ refreshToken: z.string().min(1), scope: z.string(), ownerHash: z.string().regex(OWNER_HASH), savedAt: z.iso.datetime() });

export class SpotifyTokenStore {
  constructor(
    private readonly file: string,
    private readonly key: Buffer | undefined,
    private readonly now: () => number = Date.now,
  ) {}

  /** Fail closed：沒有可用金鑰時拒絕寫入（呼叫端會讓連結失敗，不會以明文暫存）。 */
  save(token: StoredSpotifyToken): void {
    const key = this.usableKey();
    if (!key) throw new Error('SPOTIFY_TOKEN_ENC_KEY 缺少或長度不是 32 bytes，拒絕儲存 Spotify 授權。');
    if (!OWNER_HASH.test(token.ownerHash)) throw new Error('Spotify 授權缺少擁有者，拒絕儲存。');
    const plain = JSON.stringify({ refreshToken: token.refreshToken, scope: token.scope, ownerHash: token.ownerHash, savedAt: new Date(this.now()).toISOString() });
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(AAD);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const envelope = { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(temp, JSON.stringify(envelope), { mode: FILE_MODE });
    chmodSync(temp, FILE_MODE);
    renameSync(temp, this.file);
    chmodSync(this.file, FILE_MODE);
  }

  /** 不存在、金鑰不符、被竄改或格式不對都回 null（視為未連結），不丟例外。 */
  load(): StoredSpotifyToken | null {
    const key = this.usableKey();
    if (!key) return null;
    try {
      const envelope = EnvelopeSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')));
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
      decipher.setAAD(AAD);
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8');
      const parsed = PlainSchema.parse(JSON.parse(plain));
      return { refreshToken: parsed.refreshToken, scope: parsed.scope, ownerHash: parsed.ownerHash };
    } catch {
      return null;
    }
  }

  clear(): void {
    rmSync(this.file, { force: true });
  }

  private usableKey(): Buffer | undefined {
    return this.key && this.key.length === KEY_BYTES ? this.key : undefined;
  }
}
