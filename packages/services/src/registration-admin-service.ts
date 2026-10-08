import { Types } from "mongoose";
import { ActionError } from "@tbook/actions";
import {
  BookingModel,
  bookingRepository,
  eventRepository,
  voucherRepository,
  type IBooking,
} from "@tbook/db";
import type { BillingInfo, BookingAttendee, Customer, PaymentMethod, Selections } from "@tbook/schemas";
import {
  createPendingBooking,
  quote,
  type BookingPolicyOverrides,
} from "./booking-service";
import { resolveBookingScope } from "./booking-admin-service";
import { afterBookingPaid } from "./checkout-service";
import { issueVoucherRowsForBooking } from "./voucher-service";
import { storeFile } from "./media-storage";
import { dispatchWebhookEvent, bookingWebhookData } from "./webhook-service";

/**
 * Admin-side registration management: creating a registration by hand,
 * editing an existing one, and recording a payment that happened outside
 * the platform.
 *
 * This is the half of the system the public booking flow can't cover. An
 * org manager routinely has to register someone who paid by bank transfer,
 * fix a misspelled name before the vouchers go out, or record an invoice
 * number issued elsewhere — none of which the storefront checkout can do.
 *
 * Permission enforcement stays at the request layer, as everywhere else in
 * this package.
 */

export interface AdminRegistrationInput {
  eventId: string;
  /** Number of tickets/entries. For a team event this is teams, not people. */
  guests: number;
  customer: Customer;
  billing?: BillingInfo | null;
  /**
   * Per-entry attendee data. A person-unit event uses `{ fields }`; a team
   * event (or one with playersPerTicket > 1) nests its roster under
   * `{ fields, members: [{ fields }] }` — the same shape the storefront
   * submits, so both paths produce identical documents.
   */
  attendees?: BookingAttendee[];
  hotelId?: string | null;
  accommodationGuests?: number | null;
  nights?: number | null;
  selections?: Selections;
  adminNote?: string;
  /** Rules an org manager may knowingly override. All default to off. */
  overrides?: BookingPolicyOverrides;
  /** Record the registration as already paid, skipping checkout entirely. */
  markPaid?: {
    method: PaymentMethod;
    reference?: string;
    note?: string;
    paidAt?: Date;
  };
}

export interface AdminRegistrationResult {
  booking: IBooking;
  /** True when markPaid ran the full after-payment pipeline (vouchers, invoice, sync, webhooks). */
  finalized: boolean;
}

/**
 * Quotes a would-be admin registration without creating anything, so the
 * console can show the price before the manager commits. Applies the same
 * overrides the create call will.
 */
export async function previewAdminRegistration(
  organizationId: string,
  input: Pick<AdminRegistrationInput, "eventId" | "guests" | "hotelId" | "accommodationGuests" | "nights" | "selections" | "overrides">,
) {
  await assertEventInOrgForRegistration(organizationId, input.eventId);
  const ctx = await quote(
    {
      eventId: input.eventId,
      guests: input.guests,
      hotelId: input.hotelId ?? undefined,
      accommodationGuests: input.accommodationGuests ?? undefined,
      nights: input.nights ?? undefined,
      selections: input.selections,
    },
    { ...input.overrides },
  );
  return {
    quote: ctx.quote,
    event: { id: String(ctx.event._id), name: ctx.event.name, currency: ctx.currency },
    registrationFieldSchema: ctx.registrationFieldSchema,
    teamMemberFieldSchema: ctx.teamMemberFieldSchema,
  };
}

/**
 * Confirms an event belongs to the acting org before registering into it.
 * Uses the organizationId-or-group rule, because real production events
 * carry no organizationId (see scripts/migration-fixtures) and a direct
 * match would make an org's own events unreachable.
 */
async function assertEventInOrgForRegistration(organizationId: string, eventId: string): Promise<void> {
  const { assertEventInOrg } = await import("./voucher-admin-service");
  await assertEventInOrg(organizationId, eventId);
}

/**
 * Creates a registration on an org manager's behalf.
 *
 * Deliberately built on createPendingBooking rather than writing a document
 * directly: that keeps pricing, capacity reservation, hotel inventory and
 * attendee validation identical to the public path, so an admin-created
 * booking is indistinguishable downstream (vouchers, invoicing, tDarts all
 * work on it unchanged). Only the provenance fields and the optional
 * mark-as-paid are extra.
 */
export async function createAdminRegistration(
  organizationId: string,
  input: AdminRegistrationInput,
  actor: { userId: string | null },
): Promise<AdminRegistrationResult> {
  await assertEventInOrgForRegistration(organizationId, input.eventId);

  const booking = await createPendingBooking(
    {
      eventId: input.eventId,
      guests: input.guests,
      customer: input.customer,
      billing: input.billing ?? undefined,
      attendees: input.attendees,
      hotelId: input.hotelId ?? undefined,
      accommodationGuests: input.accommodationGuests ?? undefined,
      nights: input.nights ?? undefined,
      selections: input.selections,
    },
    { ...input.overrides },
  );

  const bookingId = String(booking._id);

  // Provenance is set after creation rather than threaded through
  // createPendingBooking, so the public path's signature stays untouched.
  await bookingRepository.updateById(bookingId, {
    source: "admin",
    createdByUserId: actor.userId ? new Types.ObjectId(actor.userId) : null,
    adminNote: input.adminNote?.trim() ?? "",
  } as Partial<IBooking>);

  if (!input.markPaid) {
    const pending = await bookingRepository.findById(bookingId);
    return { booking: pending ?? booking, finalized: false };
  }

  const paid = await markBookingPaidOffline(organizationId, bookingId, input.markPaid, actor);
  return { booking: paid, finalized: true };
}

export interface MarkPaidInput {
  method: PaymentMethod;
  reference?: string;
  note?: string;
  paidAt?: Date;
}

/**
 * Records a payment taken outside the platform and runs the same
 * after-payment pipeline a Stripe webhook would: voucher rows, PDF +
 * email, Számlázz.hu invoice, tDarts enrolment, outbound webhooks.
 *
 * Going through afterBookingPaid rather than just flipping the status is
 * the whole point — a bank-transfer registration must end up with the same
 * artefacts as a card one, or the guest gets no ticket and the organizer
 * no invoice.
 */
export async function markBookingPaidOffline(
  organizationId: string,
  bookingId: string,
  input: MarkPaidInput,
  actor: { userId: string | null },
): Promise<IBooking> {
  const scope = await resolveBookingScope(organizationId);
  const booking = await bookingRepository.findByIdInScope(bookingId, scope);
  if (!booking) throw ActionError.notFound("Booking not found");

  if (booking.status === "paid" || booking.status === "confirmed") {
    throw ActionError.validation("This booking is already paid.");
  }
  if (booking.status === "cancelled" || booking.status === "expired") {
    throw ActionError.validation(`A ${booking.status} booking cannot be marked paid. Create a new registration instead.`);
  }

  const paidAt = input.paidAt ?? new Date();

  const updated = await BookingModel.findOneAndUpdate(
    // The status condition makes this a CAS: two managers clicking
    // "mark paid" at once cannot both run the after-payment pipeline.
    { _id: bookingId, status: { $in: ["pending", "checkout_started"] } },
    {
      $set: {
        status: "paid",
        paidAt,
        paymentMethod: input.method,
        offlinePayment: {
          method: input.method,
          reference: input.reference?.trim() ?? "",
          note: input.note?.trim() ?? "",
          markedByUserId: actor.userId ? new Types.ObjectId(actor.userId) : null,
          markedAt: new Date(),
        },
      },
    },
    { returnDocument: "after" },
  ).exec();

  if (!updated) {
    throw ActionError.validation("This booking was already finalized by someone else.");
  }

  // Same pipeline as the Stripe webhook. Never throws past its own
  // boundary, so a failing integration cannot undo the payment record.
  await afterBookingPaid(updated);

  return (await bookingRepository.findById(bookingId)) ?? updated;
}

export interface UpdateBookingDetailsInput {
  customer?: Partial<Customer>;
  billing?: BillingInfo | null;
  attendees?: BookingAttendee[];
  adminNote?: string;
}

export interface UpdateBookingDetailsResult {
  booking: IBooking;
  /** Active vouchers whose display name was updated to match the edit. */
  vouchersRenamed: number;
  /**
   * Vouchers whose name would have changed but were left alone because they
   * are already checked in (an attendance record) or void. Surfaced so the
   * console can say so instead of implying the edit reached every ticket.
   */
  vouchersSkipped: number;
  /** Set when attendee data changed on a booking already synced to tDarts. */
  tdartsResyncRequired: boolean;
}

/**
 * Edits a booking's contact and attendee details.
 *
 * Attendee edits are validated against the booking's *own*
 * `attendeeFieldSchema` snapshot rather than the event's current schema:
 * the snapshot is what the guest actually filled in, and re-validating
 * against a schema the organizer has since changed would reject
 * corrections to historical bookings for reasons the editor can't fix.
 *
 * Price is deliberately not recalculated. Changing a name must not silently
 * re-price a paid booking, and a genuine price change is a cancel-and-
 * rebook, not an edit.
 */
export async function updateBookingDetails(
  organizationId: string,
  bookingId: string,
  input: UpdateBookingDetailsInput,
): Promise<UpdateBookingDetailsResult> {
  const scope = await resolveBookingScope(organizationId);
  const booking = await bookingRepository.findByIdInScope(bookingId, scope);
  if (!booking) throw ActionError.notFound("Booking not found");

  const set: Record<string, unknown> = {};

  // Dotted paths, never a whole replacement `customer` object: spreading a
  // Mongoose subdocument yields its internals rather than its fields and
  // would wipe the values being preserved.
  if (input.customer) {
    for (const key of ["name", "email", "phone", "note"] as const) {
      const value = input.customer[key];
      if (value === undefined) continue;
      set[`customer.${key}`] = key === "email" ? String(value).trim().toLowerCase() : String(value).trim();
    }
  }

  if (input.billing !== undefined) set.billing = input.billing;
  if (input.adminNote !== undefined) set.adminNote = input.adminNote.trim();

  let attendeesChanged = false;
  if (input.attendees) {
    const { validateAttendees, normalizeAttendeePayload } = await import("./booking-validation");

    const schema = booking.attendeeFieldSchema ?? [];
    const memberSchema = booking.teamMemberFieldSchema ?? [];
    const playersPerTicket = booking.playersPerTicket ?? 1;

    const issues = validateAttendees(schema, booking.guests, input.attendees, memberSchema.length > 0 ? "team" : "person", {
      teamMemberFieldSchema: memberSchema,
      teamMemberLimit: booking.teamMemberLimit ?? null,
      playersPerTicket: playersPerTicket > 1 ? playersPerTicket : null,
    });
    if (issues.length > 0) {
      throw ActionError.validation("Please check the attendee details.", { issues });
    }

    set.attendees = normalizeAttendeePayload(schema, input.attendees, memberSchema);
    attendeesChanged = true;
  }

  if (Object.keys(set).length === 0) {
    return { booking, vouchersRenamed: 0, vouchersSkipped: 0, tdartsResyncRequired: false };
  }

  const updated = await BookingModel.findByIdAndUpdate(bookingId, { $set: set }, { returnDocument: "after" }).exec();
  if (!updated) throw ActionError.notFound("Booking not found");

  // An attendee rename has to reach the voucher, or the name on the ticket
  // no longer matches the person at the door.
  const voucherChanges = attendeesChanged
    ? await refreshVoucherNames(bookingId, updated)
    : { updated: 0, skipped: 0 };

  const tdartsResyncRequired = attendeesChanged && (updated.tdartsSync ?? []).length > 0;

  await dispatchWebhookEvent(organizationId, "booking.updated", bookingWebhookData(updated));

  return {
    booking: updated,
    vouchersRenamed: voucherChanges.updated,
    vouchersSkipped: voucherChanges.skipped,
    tdartsResyncRequired,
  };
}

/**
 * Re-points voucher display names at the edited attendee data, so the name
 * on the ticket keeps matching the person who will present it.
 *
 * Only `active` vouchers are rewritten. A `checked_in` voucher is an
 * attendance record — someone with that name was admitted through the door
 * — and silently rewriting it would falsify the record; a `void` one
 * belongs to a cancelled booking. Both are reported back as `skipped` so
 * the console can tell the manager their edit didn't reach those tickets
 * rather than leaving them to assume it did.
 *
 * Only the stored name changes here. Re-issuing the PDF emails the guest,
 * so that stays a separate, explicit action ("re-send entries").
 */
async function refreshVoucherNames(
  bookingId: string,
  booking: IBooking,
): Promise<{ updated: number; skipped: number }> {
  const { resolveAttendeeDisplayName } = await import("./voucher-service");
  const vouchers = await voucherRepository.findByBookingId(bookingId);
  if (vouchers.length === 0) return { updated: 0, skipped: 0 };

  let updated = 0;
  let skipped = 0;

  for (const voucher of vouchers) {
    const displayName = resolveAttendeeDisplayName(
      voucher.attendeeIndex,
      booking.attendees ?? [],
      booking.attendeeFieldSchema ?? [],
      booking.customer?.name ?? "",
      booking.guests,
      booking.teamMemberFieldSchema ?? [],
    );
    if (!displayName || displayName === voucher.displayName) continue;

    if (voucher.status !== "active") {
      skipped += 1;
      continue;
    }

    await voucherRepository.updateById(String(voucher._id), { displayName });
    updated += 1;
  }

  return { updated, skipped };
}

export interface AttachInvoiceInput {
  /** Human-readable invoice number, as issued by whatever system produced it. */
  invoiceNumber: string;
  /** Optional PDF bytes to store alongside it. */
  pdf?: { bytes: Buffer | Uint8Array; fileName?: string } | null;
}

/**
 * Records an invoice issued outside the platform — the common case for an
 * org that invoices from its own accounting system, or for a booking whose
 * automatic Számlázz.hu issue failed.
 *
 * Marks `invoiceSource: "manual"` so a hand-recorded invoice is never
 * mistaken for a provider-issued one, and so a later automatic issue
 * attempt can tell it already has a number.
 */
export async function attachInvoiceToBooking(
  organizationId: string,
  bookingId: string,
  input: AttachInvoiceInput,
): Promise<IBooking> {
  const scope = await resolveBookingScope(organizationId);
  const booking = await bookingRepository.findByIdInScope(bookingId, scope);
  if (!booking) throw ActionError.notFound("Booking not found");

  const invoiceNumber = input.invoiceNumber.trim();
  if (!invoiceNumber) throw ActionError.validation("An invoice number is required.");

  const set: Record<string, unknown> = {
    invoiceNumber,
    invoiceStatus: "issued",
    invoiceSource: "manual",
    // Clears a previous automatic failure, so the console stops showing a
    // stale error next to an invoice that now exists.
    invoiceError: null,
  };

  if (input.pdf) {
    const bytes = Buffer.from(input.pdf.bytes);
    if (bytes.subarray(0, 4).toString("latin1") !== "%PDF") {
      throw ActionError.validation("That file is not a PDF.");
    }
    const { url } = await storeFile(bytes, {
      subdir: "invoices",
      // Named after the booking, not the upload, so the guest-facing
      // download route can find it by booking id alone.
      fileName: `${bookingId}-manual.pdf`,
    });
    set.invoicePdfFileName = url;
  }

  const updated = await BookingModel.findByIdAndUpdate(bookingId, { $set: set }, { returnDocument: "after" }).exec();
  if (!updated) throw ActionError.notFound("Booking not found");
  return updated;
}

/**
 * Issues voucher rows for a booking that should have them but doesn't —
 * e.g. one marked paid before voucher issuance existed, or whose issuance
 * failed. Idempotent via issueVoucherRowsForBooking.
 */
export async function ensureVouchersForBooking(organizationId: string, bookingId: string): Promise<number> {
  const scope = await resolveBookingScope(organizationId);
  const booking = await bookingRepository.findByIdInScope(bookingId, scope);
  if (!booking) throw ActionError.notFound("Booking not found");
  if (booking.status !== "paid" && booking.status !== "confirmed") {
    throw ActionError.validation("Only a paid booking has entries.");
  }

  const rows = await issueVoucherRowsForBooking(bookingId);
  return rows.length;
}

/** Events an admin may register into, including ones whose sales have closed. */
export async function listRegistrableEvents(organizationId: string): Promise<
  Array<{
    id: string;
    name: string;
    status: string;
    registrationUnit: string;
    playersPerTicket: number;
    teamMemberLimit: number | null;
    capacity: number | null;
    soldGuestCount: number;
    startDate: Date | null;
  }>
> {
  const { eventGroupRepository } = await import("@tbook/db");
  const groups = await eventGroupRepository.findByOrganizationId(organizationId);
  const perGroup = await Promise.all(groups.map((group) => eventRepository.findByGroupId(String(group._id))));

  return perGroup.flat().map((event) => ({
    id: String(event._id),
    name: event.name,
    status: event.status,
    registrationUnit: event.registrationUnit ?? "person",
    playersPerTicket: event.playersPerTicket ?? 1,
    teamMemberLimit: event.teamMemberLimit ?? null,
    capacity: event.capacity ?? null,
    soldGuestCount: event.soldGuestCount ?? 0,
    startDate: event.startDate ?? null,
  }));
}
