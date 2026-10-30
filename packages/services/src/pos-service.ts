import { ActionError } from "@tbook/actions";
import type { BillingInfo, BookingAttendee, Customer, PosPaymentMethod } from "@tbook/schemas";
import { createAdminRegistration, type AdminRegistrationInput } from "./registration-admin-service";
import { bookingRepository } from "@tbook/db";

/**
 * On-site sales ("point of sale"). A seller picks an event, takes cash or a
 * card payment, enters the customer, and the platform issues the paid
 * ticket and the invoice and emails both.
 *
 * Built on createAdminRegistration + markPaid on purpose: that path is the
 * one that already runs the full after-payment pipeline (vouchers, PDF and
 * email, Számlázz.hu invoice, tDarts, webhooks) with the same pricing and
 * capacity rules as the storefront, so a counter sale is indistinguishable
 * from an online one downstream. What this adds is the seller-facing
 * contract: a stricter input (billing required, counter payment methods
 * only, no policy overrides) and a delivery report.
 */

export interface PosSaleInput {
  eventId: string;
  tickets: number;
  customer: Customer;
  billing: BillingInfo;
  paymentMethod: PosPaymentMethod;
  /** Card terminal slip / transaction number, or a cash receipt number. */
  reference?: string;
  attendees?: BookingAttendee[];
  note?: string;
}

export interface PosSaleResult {
  bookingId: string;
  totalHuf: number;
  currency: string;
  /** Voucher rows exist and the email was attempted. */
  vouchersIssued: number;
  invoiceStatus: string;
  invoiceError: string | null;
  invoiceEmailed: boolean;
}

export async function createPosSale(
  organizationId: string,
  input: PosSaleInput,
  actor: { userId: string | null },
): Promise<PosSaleResult> {
  if (!input.billing) throw ActionError.validation("Billing details are required so an invoice can be issued.");

  const registration: AdminRegistrationInput = {
    eventId: input.eventId,
    guests: input.tickets,
    customer: input.customer,
    billing: input.billing,
    attendees: input.attendees,
    adminNote: input.note,
    source: "pos",
    // No overrides: a seller must not be able to sell past capacity or
    // outside the sales window. Only a console manager can do that.
    overrides: {},
    markPaid: { method: input.paymentMethod, reference: input.reference },
  };

  const { booking } = await createAdminRegistration(organizationId, registration, actor);
  const fresh = (await bookingRepository.findById(String(booking._id))) ?? booking;

  const { voucherRepository } = await import("@tbook/db");
  const vouchers = await voucherRepository.findByBookingId(String(fresh._id));

  return {
    bookingId: String(fresh._id),
    totalHuf: fresh.totalHuf,
    currency: fresh.currency,
    vouchersIssued: vouchers.length,
    invoiceStatus: fresh.invoiceStatus,
    invoiceError: fresh.invoiceError ?? null,
    invoiceEmailed: Boolean(fresh.invoiceEmailSentAt),
  };
}
