import "@/lib/register-modules";
import { ActionError } from "@tbook/actions";
import { ensureDbConnection } from "@tbook/db";
import { NextResponse } from "next/server";

/**
 * Public v1 API response shaping — byte-compatible with the legacy plugin's
 * api/handlers.ts `json()`/`errorMessage()` helpers, deliberately NOT using
 * this repo's own `runAction`/ActionError envelope (that's `apps/web/src/lib/
 * api-response.ts`, used by v2). The still-running Sörfeszt/World Darts
 * Festival storefronts parse this exact shape — success is
 * `{ ok: true, ...data }`, failure is `{ error: "message" }` with the
 * thrown error's status (default 400).
 */

/** A v1-specific HTTP error carrying the legacy `statusCode` convention. */
export class V1HttpError extends Error {
  readonly statusCode: number;
  readonly retryAfterSec?: number;

  constructor(statusCode: number, message: string, retryAfterSec?: number) {
    super(message);
    this.name = "V1HttpError";
    this.statusCode = statusCode;
    this.retryAfterSec = retryAfterSec;
  }
}

/** Allowed browser origins for the public API — reads TBOOK_API_CORS_ORIGINS (comma-separated). */
export function v1CorsHeaders(request?: Request): HeadersInit | undefined {
  const raw = process.env.TBOOK_API_CORS_ORIGINS?.trim();
  if (!raw || !request) return undefined;
  const allowed = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = request.headers.get("origin");
  if (!origin || !allowed.includes(origin)) return undefined;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-TBook-Api-Key, X-TBook-Preview, X-TBook-Test, Authorization",
    Vary: "Origin",
  };
}

export function v1Json(data: unknown, status = 200, request?: Request): NextResponse {
  const headers = v1CorsHeaders(request);
  return NextResponse.json(data, { status, headers });
}

function statusOf(error: unknown): number {
  if (error instanceof V1HttpError) return error.statusCode;
  if (error instanceof ActionError) return error.status;
  if (error && typeof error === "object" && "statusCode" in error && typeof (error as { statusCode?: unknown }).statusCode === "number") {
    return (error as { statusCode: number }).statusCode;
  }
  return 400;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * The one place every v1 route maps a thrown error to the legacy
 * `{ error: "message" }` envelope. Route handlers call this from a top-level
 * try/catch rather than each reimplementing status-code resolution.
 */
export function v1ErrorResponse(error: unknown, request?: Request, fallback = "Something went wrong"): NextResponse {
  if (!(error instanceof V1HttpError || error instanceof ActionError)) {
    console.error("[tbook v1]", error);
  }
  // Added (never renamed): `code`, a machine-readable reason (e.g. "capacity_full", "on_waitlist", "not_full").
  const code = error instanceof ActionError ? error.code : undefined;
  return v1Json(code ? { error: messageOf(error, fallback), code } : { error: messageOf(error, fallback) }, statusOf(error), request);
}

/**
 * Wraps a v1 route body: success -> legacy envelope, thrown error -> legacy
 * error envelope. Also the v1 surface's database-connection guard — every
 * v1 route funnels through here, and nothing else on the request path opens
 * a connection (importing a Mongoose model does not).
 */
export async function runV1<T>(request: Request, fn: () => Promise<T>): Promise<NextResponse> {
  try {
    await ensureDbConnection();
    const data = await fn();
    return v1Json({ ok: true, ...(data as object) }, 200, request);
  } catch (error) {
    return v1ErrorResponse(error, request);
  }
}
