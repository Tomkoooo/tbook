import { eventRepository } from "@tbook/db";
import { waitlist } from "@tbook/modules";
import { getPublicEventDetail } from "@tbook/services";
import { requireApiKeyGroup } from "@/lib/v1/auth";
import { runV1, V1HttpError } from "@/lib/v1/response";

/**
 * v1 — byte-compatible with the legacy plugin's public GET /events/:eventId.
 * Added (never renamed): `waitlistOpen` — the event is full and takes
 * waitlist entries (POST /waitlist/join).
 */
export async function GET(request: Request, context: { params: Promise<{ eventId: string }> }) {
  return runV1(request, async () => {
    const { groupId } = await requireApiKeyGroup(request);
    const { eventId } = await context.params;
    const detail = await getPublicEventDetail(groupId, eventId);
    if (!detail) throw new V1HttpError(404, "Event not found");
    const event = await eventRepository.findById(eventId);
    return { ...detail, waitlistOpen: event ? await waitlist.waitlistAvailable(event) : false };
  });
}
