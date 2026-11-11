import { eventRepository } from "@tbook/db";
import { prefillRegistration } from "@tbook/services";
import { requireApiKeyGroup } from "@/lib/v1/auth";
import { enforceV1RateLimit } from "@/lib/v1/rate-limit";
import { runV1, V1HttpError } from "@/lib/v1/response";

/**
 * v1 — "start with your ID". POST { code } → { found, alreadyRegistered, fields }.
 * The form's identifying answer is looked up in the data list it is checked
 * against, and the answers mapped to list columns come back to start the
 * form with (all editable). An already registered ID returns no data.
 * Tightly rate-limited: it returns a person's details for an ID.
 */
export async function POST(request: Request, context: { params: Promise<{ eventId: string }> }) {
  return runV1(request, async () => {
    const { groupId } = await requireApiKeyGroup(request);
    enforceV1RateLimit(request, "t-book:prefill", 30);
    const { eventId } = await context.params;
    const event = await eventRepository.findById(eventId);
    if (!event || String(event.groupId) !== groupId || event.status !== "active") throw new V1HttpError(404, "Event not found");
    const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
    const code = String(body?.code ?? "").trim();
    if (!code) throw new V1HttpError(400, "code is required.");
    return prefillRegistration(eventId, code);
  });
}
