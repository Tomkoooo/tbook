import { cancelBookingAsAdmin, confirmBookingAsAdmin, getBookingDetailForOrg, updateBookingDetails } from "@tbook/services";
import { adminBookingActionSchema, adminUpdateBookingSchema } from "@tbook/schemas";
import { parseInput } from "@tbook/actions";
import { requireOrgPermission } from "@/lib/admin-auth";
import { readJsonBody, runV2 } from "@/lib/v2/response";
import { toBookingDetail, toVoucherDto } from "@/lib/v2/serialize";

/** v2 — one booking with its entries. 404s another org's booking rather than 403ing it. */
export async function GET(_request: Request, context: { params: Promise<{ bookingId: string }> }) {
  return runV2(async () => {
    const { organizationId } = await requireOrgPermission("booking:read");
    const { bookingId } = await context.params;

    const { booking, vouchers } = await getBookingDetailForOrg(organizationId, bookingId);
    return { data: { ...toBookingDetail(booking), vouchers: vouchers.map(toVoucherDto) } };
  });
}

/**
 * v2 — the admin lifecycle actions. A discriminated union on `action`
 * rather than a free-form status patch, so an admin can only make the
 * transitions this console actually supports; booking-service still
 * validates the transition itself against
 * VALID_BOOKING_STATUS_TRANSITIONS.
 */
export async function PATCH(request: Request, context: { params: Promise<{ bookingId: string }> }) {
  return runV2(async () => {
    const { organizationId } = await requireOrgPermission("booking:manage");
    const { bookingId } = await context.params;
    const input = parseInput(adminBookingActionSchema, await readJsonBody(request));

    const booking =
      input.action === "cancel"
        ? await cancelBookingAsAdmin(organizationId, bookingId, { reason: input.reason })
        : await confirmBookingAsAdmin(organizationId, bookingId);

    return { data: toBookingDetail(booking) };
  });
}

/**
 * v2 — edit contact details and attendee data. Separate from PATCH, which
 * drives status transitions: a rename and a cancellation are different kinds
 * of operation and conflating them into one endpoint would make the
 * permission story and the payload ambiguous.
 */
export async function PUT(request: Request, context: { params: Promise<{ bookingId: string }> }) {
  return runV2(async () => {
    const { organizationId } = await requireOrgPermission("booking:manage");
    const { bookingId } = await context.params;
    const input = parseInput(adminUpdateBookingSchema, await readJsonBody(request));

    const result = await updateBookingDetails(organizationId, bookingId, input);
    return {
      data: toBookingDetail(result.booking),
      meta: {
        vouchersRenamed: result.vouchersRenamed,
        vouchersSkipped: result.vouchersSkipped,
        // The tDarts partner API has no update endpoint yet, so a stale
        // roster has to be reported rather than silently tolerated.
        tdartsResyncRequired: result.tdartsResyncRequired,
      },
    };
  });
}
