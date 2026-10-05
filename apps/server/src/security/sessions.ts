/**
 * Anonymous sessions with optional private, atomic disk persistence (single process).
 * The cookie only carries a high-entropy opaque id; the CSRF token is returned in the body.
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { FeedbackReceipt, ShowPlan } from '@qualia/contracts';

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

const SessionSchema = z.strictObject({
  id: z.string().min(32), publicId: z.string().min(1), csrfToken: z.string().min(32),
  createdAt: z.number().finite(), expiresAt: z.number().finite(),
});
const ContextSchema = z.strictObject({
  ownerId: z.string(), showId: z.string(),
  seed: z.strictObject({ text: z.string(), artist: z.string().nullable() }),
  segments: z.array(z.strictObject({
    segmentId: z.string(), candidate: z.strictObject({ title: z.string(), artist: z.string() }),
  })).max(7),
});
type FeedbackContext = z.infer<typeof ContextSchema>;
const FileSchema = z.strictObject({
  version: z.literal(1), sessions: z.array(SessionSchema).max(MAX_SESSIONS),
  contexts: z.array(ContextSchema).max(2_000),
});

export interface SessionPersistence {
  load(): string | null;
  save(body: string): void;
}

export class SessionStore {
  private sessions = new Map<string, Session>();
  private contexts = new Map<string, FeedbackContext>();
  private readonly feedback = new Map<string, Promise<FeedbackReceipt>>();

  constructor(private readonly persistence?: SessionPersistence, private readonly now: () => number = Date.now) {
    let state: z.infer<typeof FileSchema>;
    try {
      const body = persistence?.load();
      if (body == null) return;
      state = FileSchema.parse(JSON.parse(body));
    } catch {
      // Do not echo JSON, cookie ids or CSRF tokens in startup errors.
      throw new Error('Session store is unreadable or invalid; file left unchanged.');
    }
    for (const session of state.sessions) {
      if (session.expiresAt > now()) this.sessions.set(session.id, session);
    }
    for (const context of state.contexts) {
      if (this.sessions.has(context.ownerId)) this.contexts.set(context.showId, context);
    }
  }

  /** Only server-validated original nominations; no provider track/token/audio fields. */
  rememberShow(ownerId: string, show: ShowPlan): void {
    if (!this.persistence) return;
    const context = ContextSchema.parse({
      ownerId, showId: show.showId, seed: { text: show.seed.text, artist: show.seed.artist },
      segments: show.segments.map(({ segmentId, candidate }) => ({
        segmentId, candidate: { title: candidate.title, artist: candidate.artist },
      })),
    });
    this.commit(() => {
      if (this.contexts.size >= 2_000) {
        const oldest = this.contexts.keys().next().value;
        if (oldest !== undefined) this.contexts.delete(oldest);
      }
      this.contexts.set(show.showId, context);
    });
  }

  feedbackContext(ownerId: string, showId: string): FeedbackContext | undefined {
    const context = this.contexts.get(showId);
    return context?.ownerId === ownerId && this.get(ownerId, this.now()) ? context : undefined;
  }

  saveFeedback(ownerId: string, showId: string, key: string, save: () => Promise<FeedbackReceipt>): Promise<FeedbackReceipt> {
    if (!this.feedbackContext(ownerId, showId)) throw new Error('feedback requires an owned context');
    const intent = JSON.stringify([ownerId, showId, key]);
    const existing = this.feedback.get(intent);
    if (existing) return existing;
    const pending = Promise.resolve().then(save).catch((error: unknown) => {
      this.feedback.delete(intent);
      throw error;
    });
    if (this.feedback.size >= 2_000) {
      const oldest = this.feedback.keys().next().value;
      if (oldest !== undefined) this.feedback.delete(oldest);
    }
    this.feedback.set(intent, pending);
    return pending;
  }

  /** Failed writes leave the in-memory state aligned with the previous disk snapshot. */
  private commit(change: () => void): void {
    const previousSessions = new Map(this.sessions);
    const previousContexts = new Map(this.contexts);
    try { change(); this.persist(); }
    catch {
      this.sessions = previousSessions;
      this.contexts = previousContexts;
      throw new Error('Session store write failed.');
    }
  }

  private persist(): void {
    if (!this.persistence) return;
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= this.now()) this.sessions.delete(id);
    }
    for (const [id, context] of this.contexts) {
      if (!this.sessions.has(context.ownerId)) this.contexts.delete(id);
    }
    this.persistence.save(JSON.stringify({ version: 1, sessions: [...this.sessions.values()], contexts: [...this.contexts.values()] }));
  }

  create(now: number): Session {
    const session: Session = {
      id: token(),
      publicId: `ses_${randomBytes(6).toString('hex')}`,
      csrfToken: token(),
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    };
    this.commit(() => {
      this.evictIfFull();
      this.sessions.set(session.id, session);
    });
    return session;
  }

  get(id: string | undefined, now: number): Session | undefined {
    if (!id) return undefined;
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (session.expiresAt <= now) {
      this.delete(id);
      return undefined;
    }
    return session;
  }

  delete(id: string): void {
    this.commit(() => { this.sessions.delete(id); });
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
