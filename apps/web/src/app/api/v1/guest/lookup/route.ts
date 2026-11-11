import { guestPortal } from "@tbook/modules";
import { requireApiKeyGroup } from "@/lib/v1/auth";
import { readGuestBody } from "@/lib/v1/guest";
import { enforceV1RateLimit } from "@/lib/v1/rate-limit";
import { runV1 } from "@/lib/v1/response";

/**
 * v1 — guest self-service (module "guest-portal"): finds a registration by
 * registration number or identifying answer. POST { eventId, code }.
 * Returns the guest's answers (contact details masked), the form with live
 * options, bus + captain details and the transfer rules.
 */
export async function POST(request: Request) {
  return runV1(request, async () => {
    const { groupId } = await requireApiKeyGroup(request);
    enforceV1RateLimit(request, "t-book:guest", 20);
    const { eventId, code } = await readGuestBody(request);
    return { guest: await guestPortal.lookupGuest(eventId, code, groupId) };
  });
}
