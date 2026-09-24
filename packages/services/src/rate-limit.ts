/**
 * Ported from the legacy plugin's lib/rate-limit.ts — a lightweight
 * fixed-window in-memory rate limiter for public tBook endpoints.
 * Per-instance only (no shared store) — good enough as a brute-force guard
 * on quote/booking creation; the API key itself is the primary gate.
 */

interface WindowEntry {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowEntry>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

export function checkRateLimit(key: string, limit: number, windowMs: number, now: number = Date.now()): RateLimitResult {
  const entry = windows.get(key);
  if (!entry || entry.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (entry.count >= limit) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

export function clientKeyFromRequest(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return `${scope}:${ip}`;
}

/** Test helper. */
export function resetRateLimits(): void {
  windows.clear();
}
