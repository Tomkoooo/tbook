import { guestPortal } from "@tbook/modules";
import { requireApiKeyGroup } from "@/lib/v1/auth";
import { readGuestBody } from "@/lib/v1/guest";
import { enforceV1RateLimit } from "@/lib/v1/rate-limit";
import { runV1, V1HttpError } from "@/lib/v1/response";

/**
 * v1 — guest self-service: changes the guest's own answers.
 * POST { eventId, code, fields: { key: value } }. Only questions marked
 * `editable` in the lookup are applied; bus changes respect seat limits.
 * The guest's confirmation email is sent again.
 * With the preview key (X-TBook-Preview) it also works on a draft event and
 * finds test registrations (searched first); without it a draft event and
 * test registrations are "not found". A test registration's response adds
 * `test: true`.
 */
export async function POST(request: Request) {
  return runV1(request, async () => {
    const { groupId, preview } = await requireApiKeyGroup(request);
    enforceV1RateLimit(request, "t-book:guest", 20);
    const { eventId, code, body } = await readGuestBody(request);
    const fields = body.fields;
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new V1HttpError(400, "fields must be an object.");
    return { guest: await guestPortal.updateGuest(eventId, code, fields as Record<string, unknown>, groupId, { preview }) };
  });
}
