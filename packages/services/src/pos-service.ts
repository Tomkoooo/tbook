import { ActionError } from "@tbook/actions";
import { dayAvailability, toGrossAmount, todayDayKey } from "@tbook/domain";
import type { BillingInfo, BookingAttendee, Customer, PosPaymentMethod, Selections } from "@tbook/schemas";
import { createAdminRegistration, type AdminRegistrationInput } from "./registration-admin-service";
import { bookingRepository } from "@tbook/db";
import { assertEventInOrg } from "./voucher-admin-service";

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
  /** Day-pass events: `{ dayPasses: { "yyyy-mm-dd": count } }`. `tickets` is then derived from it. */
  selections?: Selections;
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
    selections: input.selections,
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

export interface DaySaleOption {
  date: string;
  weekend: boolean;
  /** What one pass costs the buyer, VAT included. */
  unitPriceGrossHuf: number;
  remaining: number | null;
  /** False for closed days, days already past and sold-out days. */
  bookable: boolean;
}

/**
 * The days a seller can put in a day-pass basket, with the price the buyer
 * pays and what is left. Mirrors the public storefront's view, but a seller
 * works from the counter, so it is org-scoped rather than API-key scoped.
 */
export async function getDayPassSaleOptions(organizationId: string, eventId: string): Promise<{ currency: string; days: DaySaleOption[] } | null> {
  const event = await assertEventInOrg(organizationId, eventId);
  if (event.kind !== "day_pass" || !event.dayPass) return null;

  const today = todayDayKey(new Date());
  const days = dayAvailability({
    config: event.dayPass,
    startDate: event.startDate,
    endDate: event.endDate,
    daySold: event.daySold as Record<string, number> | undefined,
  }).map((day) => ({
    date: day.date,
    weekend: day.weekend,
    unitPriceGrossHuf: Math.round(toGrossAmount(day.priceHuf, event.ticketPriceBasis ?? "net", event.ticketVatPercent ?? 27)),
    remaining: day.remaining,
    bookable: !day.closed && day.date >= today && (day.remaining === null || day.remaining > 0),
  }));
  return { currency: event.currency, days };
}
