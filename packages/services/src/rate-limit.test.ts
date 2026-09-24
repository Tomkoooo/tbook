import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, clientKeyFromRequest, resetRateLimits } from "./rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows requests under the limit", () => {
    expect(checkRateLimit("k", 3, 60_000).allowed).toBe(true);
    expect(checkRateLimit("k", 3, 60_000).allowed).toBe(true);
    expect(checkRateLimit("k", 3, 60_000).allowed).toBe(true);
  });

  it("rejects once the limit is exceeded within the window", () => {
    checkRateLimit("k2", 2, 60_000);
    checkRateLimit("k2", 2, 60_000);
    const result = checkRateLimit("k2", 2, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSec).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    const now = Date.now();
    checkRateLimit("k3", 1, 1000, now);
    expect(checkRateLimit("k3", 1, 1000, now + 500).allowed).toBe(false);
    expect(checkRateLimit("k3", 1, 1000, now + 1001).allowed).toBe(true);
  });
});

describe("clientKeyFromRequest", () => {
  it("prefers x-forwarded-for's first hop", () => {
    const request = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    expect(clientKeyFromRequest(request, "scope")).toBe("scope:1.2.3.4");
  });

  it("falls back to x-real-ip then unknown", () => {
    expect(clientKeyFromRequest(new Request("http://x", { headers: { "x-real-ip": "9.9.9.9" } }), "s")).toBe("s:9.9.9.9");
    expect(clientKeyFromRequest(new Request("http://x"), "s")).toBe("s:unknown");
  });
});
