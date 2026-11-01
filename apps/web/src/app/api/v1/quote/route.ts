import { quote, quoteMulti } from "@tbook/services";
import { requireApiKeyGroup } from "@/lib/v1/auth";
import { enforceV1RateLimit } from "@/lib/v1/rate-limit";
import { runV1 } from "@/lib/v1/response";

/**
 * v1 — byte-compatible with the legacy plugin's public POST /quote.
 * A body with an `entries` array quotes several events together
 * (multi-event: per-entry quotes plus the bundle total).
 */
export async function POST(request: Request) {
  return runV1(request, async () => {
    const { groupId } = await requireApiKeyGroup(request);
    enforceV1RateLimit(request, "t-book:quote", 120);
    const body = await request.json();
    if (Array.isArray(body?.entries)) {
      const multi = await quoteMulti(body, { groupId });
      return { lodgingMode: multi.lodgingMode, entries: multi.entries, quote: multi.quote };
    }
    const ctx = await quote(body, { groupId });
    return { quote: ctx.quote };
  });
}
