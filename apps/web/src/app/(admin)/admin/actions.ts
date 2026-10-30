"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ActionError } from "@tbook/actions";
import {
  assertUserOrganizationAccess,
  cancelBookingAsAdmin,
  confirmBookingAsAdmin,
  deleteWebhook,
  resendVoucherEmailAsAdmin,
  revertCheckInAsAdmin,
  scanVoucherAsAdmin,
  sendTestWebhook,
  upsertWebhook,
  attachInvoiceToBooking,
  createAdminRegistration,
  markBookingPaidOffline,
  updateBookingDetails,
} from "@tbook/services";
import {
  adminAttachInvoiceSchema,
  adminCreateRegistrationSchema,
  adminMarkPaidSchema,
  adminUpdateBookingSchema,
  adminWebhookUpsertSchema,
} from "@tbook/schemas";
import { parseInput } from "@tbook/actions";
import { getSessionUser, requireOrgPermission } from "@/lib/admin-auth";
import { activeOrgCookieOptions } from "@/lib/org-cookie";
import { parseAttendeesFromForm } from "@/lib/attendee-form";

/**
 * Server actions behind the console's forms.
 *
 * Each one re-checks its permission via requireOrgPermission rather than
 * trusting that the page which rendered the form had already checked: a
 * server action is its own entry point, reachable by anyone who can POST
 * to its id, so page-level gating is a UI affordance and this is the
 * actual enforcement. The v2 API routes exist alongside these for
 * programmatic/mobile clients; the console itself uses these so it needs
 * no client-side fetch layer at all.
 *
 * Every action returns a plain `{ ok }` / `{ error }` result instead of
 * throwing, so a failure renders inline in the form via useActionState
 * rather than as an error page.
 */

export interface ActionResult {
  ok: boolean;
  message?: string;
}

/** Maps a thrown ActionError to the inline result shape; anything else is logged and generalized. */
async function attempt(fn: () => Promise<string>): Promise<ActionResult> {
  try {
    return { ok: true, message: await fn() };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, message: error.message };
    console.error("[admin action]", error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export async function cancelBookingAction(bookingId: string, formData: FormData): Promise<ActionResult> {
  const result = await attempt(async () => {
    const { organizationId } = await requireOrgPermission("booking:manage");
    const reason = String(formData.get("reason") ?? "").trim();
    await cancelBookingAsAdmin(organizationId, bookingId, { reason: reason || undefined });
    return "Booking cancelled. Its entries are void and its capacity has been released.";
  });

  if (result.ok) revalidatePath(`/admin/bookings/${bookingId}`);
  return result;
}

export async function confirmBookingAction(bookingId: string): Promise<ActionResult> {
  const result = await attempt(async () => {
    const { organizationId } = await requireOrgPermission("booking:manage");
    await confirmBookingAsAdmin(organizationId, bookingId);
    return "Booking confirmed.";
  });

  if (result.ok) revalidatePath(`/admin/bookings/${bookingId}`);
  return result;
}

export async function resendEntriesAction(bookingId: string, formData: FormData): Promise<ActionResult> {
  const result = await attempt(async () => {
    const { organizationId } = await requireOrgPermission("voucher:manage");
    const toEmail = String(formData.get("toEmail") ?? "").trim();
    const { sentTo } = await resendVoucherEmailAsAdmin(organizationId, bookingId, { toEmail: toEmail || undefined });
    return `Entries re-sent to ${sentTo}.`;
  });

  if (result.ok) revalidatePath(`/admin/bookings/${bookingId}`);
  return result;
}

export interface ScanActionResult extends ActionResult {
  result?: "valid" | "duplicate" | "invalid" | "wrong_event";
  attendeeName?: string | null;
}

/**
 * Check-in scan. Unlike the others this returns the scan *outcome* rather
 * than a success/failure: "already checked in" and "wrong event" are
 * things the door operator needs to see, not errors.
 */
export async function scanAction(eventId: string, formData: FormData): Promise<ScanActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("voucher:scan");
    const code = String(formData.get("code") ?? "").trim();
    if (!code) return { ok: false, message: "Scan or type a code first." };

    const user = await getSessionUser();
    const outcome = await scanVoucherAsAdmin(organizationId, code, { eventId, userId: user?.id ?? null });

    revalidatePath(`/admin/check-in/${eventId}`);
    return {
      ok: outcome.result === "valid",
      result: outcome.result,
      message: outcome.message,
      attendeeName: outcome.voucher?.displayName ?? null,
    };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, message: error.message };
    console.error("[admin scan]", error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export async function revertCheckInAction(eventId: string, voucherId: string): Promise<ActionResult> {
  const result = await attempt(async () => {
    const { organizationId } = await requireOrgPermission("voucher:manage");
    await revertCheckInAsAdmin(organizationId, voucherId);
    return "Check-in undone.";
  });

  if (result.ok) revalidatePath(`/admin/check-in/${eventId}`);
  return result;
}

/**
 * Switches the console's active organization. Access is verified
 * server-side before the cookie is written, so setting it can never itself
 * grant access to an org the user isn't a member of.
 */
export async function selectOrganizationAction(formData: FormData): Promise<ActionResult> {
  const organizationId = String(formData.get("organizationId") ?? "").trim();

  const result = await attempt(async () => {
    const user = await getSessionUser();
    if (!user) throw ActionError.unauthorized();
    if (!organizationId) throw ActionError.validation("Pick an organization.");

    await assertUserOrganizationAccess(user.id, organizationId, { isSystemAdmin: user.isSystemAdmin });
    (await cookies()).set(activeOrgCookieOptions(organizationId));
    return "Organization selected.";
  });

  // redirect() signals by throwing, so it has to happen outside `attempt`.
  if (result.ok) redirect("/admin");
  return result;
}


/* ---- Integrations (outbound webhooks) ------------------------------- */

export interface WebhookActionResult extends ActionResult {
  /** Returned exactly once, on creation — the secret is not readable afterwards. */
  secret?: string;
}

/**
 * Creates or updates an outbound webhook endpoint. Gated on org:update
 * (this is organization configuration, not booking data) and validated
 * against the same Zod schema the v2 route uses.
 */
export async function saveWebhookAction(formData: FormData): Promise<WebhookActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("org:update");

    const input = parseInput(adminWebhookUpsertSchema, {
      id: String(formData.get("id") ?? "").trim() || undefined,
      url: String(formData.get("url") ?? ""),
      description: String(formData.get("description") ?? ""),
      // Checkbox group — getAll, since a single checkbox yields one entry.
      events: formData.getAll("events").map(String),
      enabled: formData.get("enabled") !== null,
    });

    const { secret } = await upsertWebhook({ organizationId, ...input });
    revalidatePath("/admin/integrations");

    return {
      ok: true,
      message: secret
        ? "Endpoint created. Copy the signing secret now — it won't be shown again."
        : "Endpoint updated.",
      secret,
    };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, message: error.message };
    console.error("[admin webhook save]", error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export async function deleteWebhookAction(webhookId: string): Promise<ActionResult> {
  const result = await attempt(async () => {
    const { organizationId } = await requireOrgPermission("org:update");
    await deleteWebhook(organizationId, webhookId);
    return "Endpoint removed.";
  });

  if (result.ok) revalidatePath("/admin/integrations");
  return result;
}

/**
 * Sends a sample payload so an admin can verify their receiver before a
 * real booking depends on it. A failed delivery is reported as the
 * endpoint's problem, not as an error in this console.
 */
export async function testWebhookAction(webhookId: string): Promise<ActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("org:update");
    const outcome = await sendTestWebhook(organizationId, webhookId);
    revalidatePath("/admin/integrations");

    return outcome.ok
      ? { ok: true, message: `Delivered (HTTP ${outcome.status}).` }
      : { ok: false, message: `Delivery failed: ${outcome.error ?? "unknown error"}` };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, message: error.message };
    console.error("[admin webhook test]", error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

/* ---- Registration management ---------------------------------------- */

export interface CreateRegistrationResult extends ActionResult {
  bookingId?: string;
}

/**
 * Registers people into an event by hand. Handles both single-person and
 * team/multi-player events — the difference is entirely in the attendee
 * shape, which the event's own schema determines.
 */
export async function createRegistrationAction(formData: FormData): Promise<CreateRegistrationResult> {
  try {
    const { organizationId } = await requireOrgPermission("booking:manage");
    const user = await getSessionUser();

    const guests = Math.max(Number(formData.get("guests") ?? 1) || 1, 1);
    const markPaidRequested = formData.get("markPaid") !== null;

    const input = parseInput(adminCreateRegistrationSchema, {
      eventId: String(formData.get("eventId") ?? ""),
      guests,
      customer: {
        name: String(formData.get("customer.name") ?? ""),
        email: String(formData.get("customer.email") ?? ""),
        phone: String(formData.get("customer.phone") ?? ""),
        note: String(formData.get("customer.note") ?? ""),
      },
      attendees: parseAttendeesFromForm(formData, guests),
      adminNote: String(formData.get("adminNote") ?? ""),
      overrides: {
        allowClosedSales: formData.get("allowClosedSales") !== null,
        allowInactiveEvent: formData.get("allowInactiveEvent") !== null,
        allowOverCapacity: formData.get("allowOverCapacity") !== null,
        skipEligibility: formData.get("skipEligibility") !== null,
      },
      ...(markPaidRequested
        ? {
            markPaid: {
              method: String(formData.get("paymentMethod") ?? "transfer"),
              reference: String(formData.get("paymentReference") ?? ""),
              note: String(formData.get("paymentNote") ?? ""),
            },
          }
        : {}),
    });

    const { booking, finalized } = await createAdminRegistration(organizationId, input, { userId: user?.id ?? null });
    const bookingId = String(booking._id);

    revalidatePath("/admin/bookings");
    return {
      ok: true,
      bookingId,
      message: finalized
        ? "Registration created and marked paid. Entries and invoice are being issued."
        : "Registration created as pending. Mark it paid once the payment arrives.",
    };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, message: error.message };
    console.error("[admin create registration]", error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export async function markPaidAction(bookingId: string, formData: FormData): Promise<ActionResult> {
  const result = await attempt(async () => {
    const { organizationId } = await requireOrgPermission("booking:manage");
    const user = await getSessionUser();

    const input = parseInput(adminMarkPaidSchema, {
      method: String(formData.get("method") ?? "transfer"),
      reference: String(formData.get("reference") ?? ""),
      note: String(formData.get("note") ?? ""),
    });

    await markBookingPaidOffline(organizationId, bookingId, input, { userId: user?.id ?? null });
    return "Payment recorded. Entries and invoice are being issued.";
  });

  if (result.ok) revalidatePath(`/admin/bookings/${bookingId}`);
  return result;
}

export interface UpdateBookingResult extends ActionResult {
  vouchersSkipped?: number;
  tdartsResyncRequired?: boolean;
}

/** Edits contact details and attendee data on an existing booking. */
export async function updateBookingAction(bookingId: string, formData: FormData): Promise<UpdateBookingResult> {
  try {
    const { organizationId } = await requireOrgPermission("booking:manage");

    const guests = Math.max(Number(formData.get("guests") ?? 1) || 1, 1);
    const editsAttendees = formData.get("editsAttendees") !== null;

    const input = parseInput(adminUpdateBookingSchema, {
      customer: {
        name: String(formData.get("customer.name") ?? ""),
        email: String(formData.get("customer.email") ?? ""),
        phone: String(formData.get("customer.phone") ?? ""),
      },
      adminNote: String(formData.get("adminNote") ?? ""),
      ...(editsAttendees ? { attendees: parseAttendeesFromForm(formData, guests) } : {}),
    });

    const result = await updateBookingDetails(organizationId, bookingId, input);
    revalidatePath(`/admin/bookings/${bookingId}`);

    const parts = ["Booking updated."];
    if (result.vouchersRenamed > 0) parts.push(`${result.vouchersRenamed} entry name(s) updated.`);
    if (result.vouchersSkipped > 0) {
      parts.push(`${result.vouchersSkipped} already checked-in or void entry left unchanged.`);
    }
    if (result.tdartsResyncRequired) {
      parts.push("tDarts still holds the old details — see the tDarts note below.");
    }

    return {
      ok: true,
      message: parts.join(" "),
      vouchersSkipped: result.vouchersSkipped,
      tdartsResyncRequired: result.tdartsResyncRequired,
    };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, message: error.message };
    console.error("[admin update booking]", error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

/** Records an invoice number (and optionally its PDF) issued outside the platform. */
export async function attachInvoiceAction(bookingId: string, formData: FormData): Promise<ActionResult> {
  const result = await attempt(async () => {
    const { organizationId } = await requireOrgPermission("booking:manage");
    const { invoiceNumber } = parseInput(adminAttachInvoiceSchema, {
      invoiceNumber: String(formData.get("invoiceNumber") ?? ""),
    });

    const file = formData.get("pdf");
    let pdf: { bytes: Buffer } | null = null;
    if (file instanceof File && file.size > 0) {
      if (file.size > 10 * 1024 * 1024) throw ActionError.validation("That PDF is larger than 10 MB.");
      pdf = { bytes: Buffer.from(await file.arrayBuffer()) };
    }

    await attachInvoiceToBooking(organizationId, bookingId, { invoiceNumber, pdf });
    return pdf ? "Invoice number and PDF attached." : "Invoice number recorded.";
  });

  if (result.ok) revalidatePath(`/admin/bookings/${bookingId}`);
  return result;
}
