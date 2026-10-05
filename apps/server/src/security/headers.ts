import type { RequestHandler } from 'express';

/**
 * Same-origin CSP for the built app. `media-src blob:` is needed for the client-synthesised
 * mock test tones. Spotify 關閉（預設）時不允許任何第三方來源；只有 SPOTIFY_ENABLED=true 才加入
 * 官方 Web Playback SDK（sdk.scdn.co 的 script 與 iframe）與封面圖（i.scdn.co）。
 */
const directives = (spotify: boolean): string => [
  "default-src 'self'",
  spotify ? "script-src 'self' https://sdk.scdn.co" : "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  spotify ? "img-src 'self' data: https://i.scdn.co" : "img-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  ...(spotify ? ["frame-src https://sdk.scdn.co"] : []),
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export function securityHeaders(spotify = false): RequestHandler {
  const csp = directives(spotify);
  return (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', csp);
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
  };
}
