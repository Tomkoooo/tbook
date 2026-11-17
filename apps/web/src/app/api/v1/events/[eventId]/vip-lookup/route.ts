import { lookupVip, getPublicEventDetail } from "@tbook/services";
import { requireApiKeyGroup } from "@/lib/v1/auth";
import { enforceV1RateLimit } from "@/lib/v1/rate-limit";
import { runV1, V1HttpError } from "@/lib/v1/response";

/**
 * v1 (added) — is this name on the event's VIP list? POST { name } →
 * `{ found, alreadyRegistered, name }`; `name` is the list's own spelling,
 * to be sent back as the identifying answer. Matching ignores accents, case,
 * "dr." and spacing. Rate limited like the employee-ID prefill.
 */
export async function POST(request: Request, context: { params: Promise<{ eventId: string }> }) {
  return runV1(request, async () => {
    const { groupId, preview, test } = await requireApiKeyGroup(request);
    enforceV1RateLimit(request, "t-book:vip-lookup", 20);
    const { eventId } = await context.params;
    const detail = await getPublicEventDetail(groupId, eventId, { allowDraft: preview });
    if (!detail) throw new V1HttpError(404, "Event not found");
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    if (!name) throw new V1HttpError(400, "Add meg a neved.");
    return await lookupVip(eventId, name, { isTest: test });
  });
}
