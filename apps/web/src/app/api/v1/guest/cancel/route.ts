import { guestPortal } from "@tbook/modules";
import { requireApiKeyGroup } from "@/lib/v1/auth";
import { readGuestBody } from "@/lib/v1/guest";
import { enforceV1RateLimit } from "@/lib/v1/rate-limit";
import { runV1 } from "@/lib/v1/response";

/**
 * v1 — guest self-service: cancels the guest's own (free) registration.
 * POST { eventId, code, reason? }. In a group registration only this guest
 * is cancelled. The record is kept and listed as cancelled.
 */
export async function POST(request: Request) {
  return runV1(request, async () => {
    const { groupId } = await requireApiKeyGroup(request);
    enforceV1RateLimit(request, "t-book:guest", 10);
    const { eventId, code, body } = await readGuestBody(request);
    return await guestPortal.cancelGuest(eventId, code, String(body.reason ?? ""), groupId);
  });
}
