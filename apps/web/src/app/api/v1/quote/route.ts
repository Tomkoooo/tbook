import { quote } from "@tbook/services";
import { requireApiKeyGroup } from "@/lib/v1/auth";
import { enforceV1RateLimit } from "@/lib/v1/rate-limit";
import { runV1, V1HttpError } from "@/lib/v1/response";

/**
 * v1 — byte-compatible with the legacy plugin's public POST /quote.
 * Multi-event quoting (legacy: an `entries` array body) isn't built in
 * this rewrite yet (booking-service.ts's single-event path only) — such
 * requests get a clear 501 instead of silently mishandling them.
 */
export async function POST(request: Request) {
  return runV1(request, async () => {
    const { groupId } = await requireApiKeyGroup(request);
    enforceV1RateLimit(request, "t-book:quote", 120);
    const body = await request.json();
    if (Array.isArray(body?.entries)) {
      throw new V1HttpError(501, "Multi-event quoting is not yet supported.");
    }
    const ctx = await quote(body, { groupId });
    return { quote: ctx.quote };
  });
}
