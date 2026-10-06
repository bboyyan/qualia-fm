import { randomBytes } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ERROR_MESSAGES, type ErrorCode, type ErrorEnvelope } from '@qualia/contracts';
import { logger } from './log.js';

const STATUS: Partial<Record<ErrorCode, number>> = {
  INVALID_INPUT: 400,
  SESSION_EXPIRED: 401,
  CSRF_REJECTED: 403,
  ORIGIN_REJECTED: 403,
  FEATURE_RESTRICTED: 403,
  SPOTIFY_NOT_ALLOWLISTED: 403,
  SPOTIFY_ACCOUNT_ERROR: 403,
  DEVICE_UNAVAILABLE: 409,
  NETWORK_ERROR: 502,
  NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  PIN_LIMIT_REACHED: 409,
  GEM_ALREADY_CHOSEN: 409,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  MODEL_REFUSED: 422,
  NO_RESOLVED_TRACKS: 422,
  PLAN_INVALID: 502,
  PLAN_TIMEOUT: 504,
  INTERNAL: 500,
};

const RETRYABLE: ReadonlySet<ErrorCode> = new Set([
  'SESSION_EXPIRED',
  'CSRF_REJECTED',
  'RATE_LIMITED',
  'PLAN_INVALID',
  'PLAN_TIMEOUT',
  'INTERNAL',
  'NETWORK_ERROR',
]);

export interface AppErrorOptions {
  message?: string;
  retryAfterMs?: number | null;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? ERROR_MESSAGES[code]);
    this.code = code;
    this.status = STATUS[code] ?? 500;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export function newRequestId(): string {
  return `req_${randomBytes(6).toString('hex')}`;
}

export function errorEnvelope(code: ErrorCode, requestId: string, options: AppErrorOptions = {}): ErrorEnvelope {
  return {
    error: {
      code,
      message: options.message ?? ERROR_MESSAGES[code],
      retryable: RETRYABLE.has(code),
      requestId,
      retryAfterMs: options.retryAfterMs ?? null,
    },
  };
}

export const requestIdMiddleware: RequestHandler = (_req, res, next) => {
  const requestId = newRequestId();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
};

function classify(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const type = (err as { type?: unknown } | null)?.type;
  if (type === 'entity.parse.failed' || type === 'entity.too.large') return new AppError('INVALID_INPUT');
  return new AppError('INTERNAL');
}

export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  const appError = classify(err);
  const requestId = String(res.locals.requestId ?? newRequestId());
  if (appError.code === 'INTERNAL') {
    logger.error('unhandled_error', { requestId, name: (err as Error | null)?.name ?? 'unknown' });
  }
  if (appError.retryAfterMs !== null) {
    res.setHeader('Retry-After', String(Math.ceil(appError.retryAfterMs / 1000)));
  }
  res
    .status(appError.status)
    .json(errorEnvelope(appError.code, requestId, { message: appError.message, retryAfterMs: appError.retryAfterMs }));
};
