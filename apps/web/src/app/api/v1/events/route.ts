import { ActionError } from "@tbook/actions";
import { runAction } from "@/lib/api-response";

/**
 * v1 — byte-compatible with the legacy plugin's public GET /events
 * (group-API-key scoped, X-TBook-Api-Key header). Reachable at both
 * /api/v1/events and, via the rewrite in next.config.ts,
 * /api/plugins/t-book/events — the exact path Sörfeszt/World Darts
 * Festival already call.
 *
 * Phase 3 fills this in: resolve the group from the API key
 * (requireApiKeyGroup, ported from lib/api-key.ts), list its active events
 * via @tbook/services, return the legacy response shape verbatim.
 */
export async function GET(request: Request) {
  return runAction(async () => {
    const apiKey = request.headers.get("x-tbook-api-key");
    if (!apiKey) {
      throw ActionError.unauthorized("Missing X-TBook-Api-Key header");
    }
    // TODO(phase-3): resolve group by API key, load events via @tbook/services.
    return { events: [] };
  });
}
