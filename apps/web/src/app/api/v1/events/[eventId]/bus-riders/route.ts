import { busTransport } from "@tbook/modules";
import { getPublicEventDetail } from "@tbook/services";
import { requireApiKeyGroup } from "@/lib/v1/auth";
import { enforceV1RateLimit } from "@/lib/v1/rate-limit";
import { runV1, V1HttpError } from "@/lib/v1/response";

/**
 * v1 (added, existing shapes untouched) — who has picked which bus, so
 * guests can see where friends and colleagues board and travel together.
 * GET → `{ riders: { "<choice value>": ["Name", …] } }`, keyed by the value
 * the bus question offers (`"<routeId>~<stopIndex>"`, or the plain route id).
 * Names only. Test registrations are listed only in preview + test mode.
 */
export async function GET(request: Request, context: { params: Promise<{ eventId: string }> }) {
  return runV1(request, async () => {
    const { groupId, preview, test } = await requireApiKeyGroup(request);
    enforceV1RateLimit(request, "t-book:bus-riders", 60);
    const { eventId } = await context.params;
    const detail = await getPublicEventDetail(groupId, eventId, { allowDraft: preview });
    if (!detail) throw new V1HttpError(404, "Event not found");
    return { riders: await busTransport.publicRiders(eventId, { includeTest: test }) };
  });
}
