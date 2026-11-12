import { waitlist } from "@tbook/modules";
import { requireApiKeyGroup } from "@/lib/v1/auth";
import { readGuestBody } from "@/lib/v1/guest";
import { enforceV1RateLimit } from "@/lib/v1/rate-limit";
import { runV1 } from "@/lib/v1/response";

/**
 * v1 — a guest's place on the waitlist (module "waitlist").
 * POST { eventId, code } where code is any identifying answer (e.g.
 * employee ID) of someone in an open entry → { entry: { status, position,
 * guests, names, createdAt, offerExpiresAt } }. 404 when none.
 */
export async function POST(request: Request) {
  return runV1(request, async () => {
    const { groupId } = await requireApiKeyGroup(request);
    enforceV1RateLimit(request, "t-book:guest", 20);
    const { eventId, code } = await readGuestBody(request);
    return waitlist.waitlistStatus(eventId, code, groupId);
  });
}
