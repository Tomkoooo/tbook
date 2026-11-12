import { waitlist } from "@tbook/modules";
import { requireApiKeyGroup } from "@/lib/v1/auth";
import { enforceV1RateLimit } from "@/lib/v1/rate-limit";
import { runV1, V1HttpError } from "@/lib/v1/response";

/**
 * v1 — joins a full event's waitlist (module "waitlist").
 * POST { eventId, guests?, customer: { name, email, phone }, attendees, returnBaseUrl? }
 * — the same answers as a registration; they are checked now. Returns
 * { entryId, position } and emails the "joined" notice. 409 "not_full" when
 * places are left. Preview mode (X-TBook-Preview): checked, not saved —
 * { preview: true, entryId: null, position }.
 */
export async function POST(request: Request) {
  return runV1(request, async () => {
    const { groupId, preview } = await requireApiKeyGroup(request);
    enforceV1RateLimit(request, "t-book:waitlist", 10);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.eventId !== "string") throw new V1HttpError(400, "eventId is required.");
    return waitlist.joinWaitlist(body.eventId, body as unknown as waitlist.JoinWaitlistInput, groupId, { preview });
  });
}
