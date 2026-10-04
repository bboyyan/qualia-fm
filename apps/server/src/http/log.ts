/**
 * Minimal structured logger. Logs method, path (no query), status and requestId only —
 * never cookies, headers, request bodies, Seeds or tokens (docs/09).
 */
import type { RequestHandler } from 'express';

type Fields = Record<string, string | number | boolean | null>;

const SENSITIVE_KEY = /authorization|cookie|token|secret|key|password|seed|text|prompt/i;

export function redact(fields: Fields): Fields {
  return Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '[redacted]' : v]),
  );
}

let silent = process.env.NODE_ENV === 'test';

export function setLoggerSilent(value: boolean): void {
  silent = value;
}

function write(level: 'info' | 'error', event: string, fields: Fields = {}): void {
  if (silent) return;
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...redact(fields) });
  (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
}

export const logger = {
  info: (event: string, fields?: Fields): void => write('info', event, fields),
  error: (event: string, fields?: Fields): void => write('error', event, fields),
};

export const accessLog: RequestHandler = (req, res, next) => {
  const started = performance.now();
  res.on('finish', () => {
    logger.info('http', {
      method: req.method,
      path: req.originalUrl.split('?')[0] ?? req.path,
      status: res.statusCode,
      ms: Math.round(performance.now() - started),
      requestId: String(res.locals.requestId ?? ''),
    });
  });
  next();
};
