/** Origin, session and CSRF guards (docs/08 通則, docs/09 OAuth 與 session). */
import { timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { HEADERS } from '@qualia/contracts';
import { AppError } from '../http/errors.js';
import { SESSION_COOKIE, readCookie, type Session, type SessionStore } from './sessions.js';

export function assertAllowedOrigin(req: Request, allowedOrigins: readonly string[]): void {
  const origin = req.get('origin');
  if (origin !== undefined && !allowedOrigins.includes(origin)) throw new AppError('ORIGIN_REJECTED');
  if (req.get('sec-fetch-site') === 'cross-site') throw new AppError('ORIGIN_REJECTED');
}

export function sessionOf(res: Response): Session {
  const session = res.locals.session as Session | undefined;
  if (!session) throw new AppError('SESSION_EXPIRED');
  return session;
}

export function requireSession(store: SessionStore, now: () => number): RequestHandler {
  return (req, res, next) => {
    const session = store.get(readCookie(req.get('cookie'), SESSION_COOKIE), now());
    if (!session) throw new AppError('SESSION_EXPIRED');
    res.locals.session = session;
    next();
  };
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Must run after requireSession. Applies to every state-changing method. */
export function requireCsrf(allowedOrigins: readonly string[]): RequestHandler {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    assertAllowedOrigin(req, allowedOrigins);
    const provided = req.get(HEADERS.csrf) ?? '';
    if (!safeEqual(provided, sessionOf(res).csrfToken)) throw new AppError('CSRF_REJECTED');
    next();
  };
}
