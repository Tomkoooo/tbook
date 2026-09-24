import { checkRateLimit, clientKeyFromRequest } from "@tbook/services";
import { V1HttpError } from "./response";

/** Throws a 429 V1HttpError once the per-scope, per-client rate limit is exceeded. */
export function enforceV1RateLimit(request: Request, scope: string, limit: number): void {
  const envOverride = Number(process.env.TBOOK_RATE_LIMIT_OVERRIDE);
  const effective = Number.isFinite(envOverride) && envOverride > 0 ? Math.floor(envOverride) : limit;
  const result = checkRateLimit(clientKeyFromRequest(request, scope), effective, 60_000);
  if (!result.allowed) {
    throw new V1HttpError(429, "Too many requests — try again shortly.", result.retryAfterSec);
  }
}
