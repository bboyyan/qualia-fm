/** Sliding-window limiter kept in memory. Bounded key count so it cannot grow without limit. */
const MAX_KEYS = 5_000;

export interface LimitResult {
  ok: boolean;
  retryAfterMs: number;
}

export class WindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  hit(key: string, now: number): LimitResult {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      const oldest = recent[0] ?? now;
      return { ok: false, retryAfterMs: Math.max(0, this.windowMs - (now - oldest)) };
    }
    if (!this.hits.has(key) && this.hits.size >= MAX_KEYS) {
      const first = this.hits.keys().next().value;
      if (first !== undefined) this.hits.delete(first);
    }
    this.hits.set(key, [...recent, now]);
    return { ok: true, retryAfterMs: 0 };
  }
}
