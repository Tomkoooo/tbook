import { listPublicEventsForGroup } from "@tbook/services";
import { requireApiKeyGroup } from "@/lib/v1/auth";
import { runV1 } from "@/lib/v1/response";

/**
 * v1 — byte-compatible with the legacy plugin's public GET /events
 * (group-API-key scoped, X-TBook-Api-Key header). Reachable at both
 * /api/v1/events and, via the rewrite in next.config.ts,
 * /api/plugins/t-book/events — the exact path Sörfeszt/World Darts
 * Festival already call.
 */
export async function GET(request: Request) {
  return runV1(request, async () => {
    const { groupId } = await requireApiKeyGroup(request);
    const events = await listPublicEventsForGroup(groupId);
    return { events };
  });
}
