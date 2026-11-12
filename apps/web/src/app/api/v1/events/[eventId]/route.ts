import { eventRepository } from "@tbook/db";
import { waitlist } from "@tbook/modules";
import { getPublicEventDetail, publicSalesState, registrationPrefillSetup } from "@tbook/services";
import { requireApiKeyGroup } from "@/lib/v1/auth";
import { runV1, V1HttpError } from "@/lib/v1/response";

/**
 * v1 — byte-compatible with the legacy plugin's public GET /events/:eventId.
 * Added (never renamed): `waitlistOpen` — the event is full and takes
 * waitlist entries (POST /waitlist/join); `registrationPrefill` — the form
 * starts with this identifying question (POST /events/{id}/prefill), or null;
 * `remainingPlaces` — capacity minus places taken or held (null = no cap);
 * `salesState` — "not_started" | "on_sale" | "closed"; `preview: true` in
 * preview mode (X-TBook-Preview), which also shows draft events.
 */
export async function GET(request: Request, context: { params: Promise<{ eventId: string }> }) {
  return runV1(request, async () => {
    const { groupId, preview } = await requireApiKeyGroup(request);
    const { eventId } = await context.params;
    const detail = await getPublicEventDetail(groupId, eventId, { allowDraft: preview });
    if (!detail) throw new V1HttpError(404, "Event not found");
    const event = await eventRepository.findById(eventId);
    const prefill = event ? registrationPrefillSetup(event as never) : null;
    return {
      ...detail,
      waitlistOpen: event ? await waitlist.waitlistAvailable(event) : false,
      registrationPrefill: prefill ? { fieldKey: prefill.fieldKey, label: prefill.label, helpText: prefill.helpText } : null,
      remainingPlaces: event?.capacity == null ? null : Math.max(event.capacity - (event.soldGuestCount ?? 0), 0),
      salesState: event ? publicSalesState(event) : "closed",
      ...(preview ? { preview: true } : {}),
    };
  });
}
