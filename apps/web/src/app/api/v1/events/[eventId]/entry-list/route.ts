import { getPublicEntryList } from "@tbook/services";
import { requireApiKeyGroup } from "@/lib/v1/auth";
import { runV1, V1HttpError } from "@/lib/v1/response";

/**
 * v1 — public entry list of a team event (byte-compatible with the legacy
 * plugin's GET /events/:eventId/entry-list, which @sironic/plugin-tbook
 * calls for events with `publicEntryList` and no tDarts bracket).
 */
export async function GET(request: Request, context: { params: Promise<{ eventId: string }> }) {
  return runV1(request, async () => {
    const { groupId } = await requireApiKeyGroup(request);
    const { eventId } = await context.params;
    const list = await getPublicEntryList(groupId, eventId);
    if (!list) throw new V1HttpError(404, "Entry list not available");
    return list;
  });
}
