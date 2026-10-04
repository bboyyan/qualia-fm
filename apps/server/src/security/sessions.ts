/**
 * In-memory anonymous sessions (single process; restart invalidates every session by design).
 * The cookie only carries a high-entropy opaque id; the CSRF token is returned in the body.
 */
import { randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'qfm_sid';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_SESSIONS = 1_000;

export interface Session {
  readonly id: string;
  /** Non-secret identifier safe to return to the client (the cookie id is never echoed). */
  readonly publicId: string;
  readonly csrfToken: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

const token = (): string => randomBytes(32).toString('base64url');

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  create(now: number): Session {
    this.evictIfFull();
    const session: Session = {
      id: token(),
      publicId: `ses_${randomBytes(6).toString('hex')}`,
      csrfToken: token(),
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string | undefined, now: number): Session | undefined {
    if (!id) return undefined;
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (session.expiresAt <= now) {
      this.sessions.delete(id);
      return undefined;
    }
    return session;
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  private evictIfFull(): void {
    if (this.sessions.size < MAX_SESSIONS) return;
    const oldest = this.sessions.keys().next().value;
    if (oldest !== undefined) this.sessions.delete(oldest);
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) return rest.join('=') || undefined;
  }
  return undefined;
}

export function sessionCookie(id: string, secure: boolean): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function clearedSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
