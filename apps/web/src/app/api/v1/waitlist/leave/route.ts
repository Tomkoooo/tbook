import { waitlist } from "@tbook/modules";
import { requireApiKeyGroup } from "@/lib/v1/auth";
import { readGuestBody } from "@/lib/v1/guest";
import { enforceV1RateLimit } from "@/lib/v1/rate-limit";
import { runV1 } from "@/lib/v1/response";

/**
 * v1 — leave the waitlist (module "waitlist"). POST { eventId, code } →
 * { left: true }. A held place goes to the next in line.
 * With the preview key (X-TBook-Preview) it also works on a draft event and
 * finds test registrations (searched first); without it a draft event and
 * test registrations are "not found". A test registration's response adds
 * `test: true`.
 */
export async function POST(request: Request) {
  return runV1(request, async () => {
    const { groupId, preview } = await requireApiKeyGroup(request);
    enforceV1RateLimit(request, "t-book:guest", 10);
    const { eventId, code } = await readGuestBody(request);
    return waitlist.leaveWaitlist(eventId, code, groupId, { preview });
  });
}
