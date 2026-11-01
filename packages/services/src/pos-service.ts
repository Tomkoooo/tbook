import { ActionError } from "@tbook/actions";
import { dayAvailability, toGrossAmount, todayDayKey } from "@tbook/domain";
import { WALK_IN_CUSTOMER_EMAIL, type BillingInfo, type BookingAttendee, type BookingDelivery, type Customer, type PosPaymentMethod, type Selections } from "@tbook/schemas";
import { createAdminRegistration, type AdminRegistrationInput } from "./registration-admin-service";
import { bookingRepository } from "@tbook/db";
import { assertEventInOrg } from "./voucher-admin-service";

/**
 * On-site sales ("point of sale"). A seller picks an event, takes cash or a
 * card payment, and either
 *   - "email": enters the customer, and the platform issues the ticket and
 *     the invoice and emails both, or
 *   - "receipt": a walk-in — no contact details, nothing emailed; a
 *     Számlázz.hu receipt is issued for printing and the entries are
 *     checked in on the spot (receipt-service.ts).
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
  /** Defaults to "email". */
  delivery?: BookingDelivery;
  /** Required for "email"; for a walk-in only the name is used, and it may be blank. */
  customer: Partial<Customer>;
  /** Required for "email" (the invoice); ignored for a walk-in. */
  billing?: BillingInfo | null;
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
  delivery: BookingDelivery;
  /** Walk-in sales only. */
  receipt: { status: string; number: string | null; error: string | null; hasPdf: boolean } | null;
}

export function posRegistration(input: PosSaleInput): AdminRegistrationInput {
  const walkIn = input.delivery === "receipt";
  let customer: Customer;
  if (walkIn) {
    customer = {
      name: input.customer.name?.trim() || "Walk-in customer",
      email: WALK_IN_CUSTOMER_EMAIL,
      phone: "-",
      note: "",
    };
  } else {
    if (!input.billing) throw ActionError.validation("Billing details are required so an invoice can be issued.");
    if (!input.customer.name?.trim() || !input.customer.email?.trim() || !input.customer.phone?.trim()) {
      throw ActionError.validation("Enter the customer's name, email and phone — the ticket and invoice are emailed to them.");
    }
    customer = { name: input.customer.name, email: input.customer.email, phone: input.customer.phone, note: input.customer.note ?? "" };
  }

  return {
    eventId: input.eventId,
    guests: input.tickets,
    delivery: walkIn ? "receipt" : "email",
    customer,
    billing: walkIn ? null : input.billing,
    attendees: input.attendees,
    selections: input.selections,
    adminNote: input.note,
    source: "pos",
    // No overrides: a seller must not be able to sell past capacity or
    // outside the sales window. Only a console manager can do that.
    overrides: {},
  };
}

export async function createPosSale(
  organizationId: string,
  input: PosSaleInput,
  actor: { userId: string | null },
): Promise<PosSaleResult> {
  const registration: AdminRegistrationInput = {
    ...posRegistration(input),
    markPaid: { method: input.paymentMethod, reference: input.reference },
  };

  const { booking } = await createAdminRegistration(organizationId, registration, actor);
  return buildPosSaleResult(String(booking._id));
}

/** Reads back what a finished sale produced: tickets, invoice state and whether the invoice mail went out. */
export async function buildPosSaleResult(bookingId: string): Promise<PosSaleResult> {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) throw ActionError.notFound("Booking not found");

  const { voucherRepository } = await import("@tbook/db");
  const vouchers = await voucherRepository.findByBookingId(bookingId);

  return {
    bookingId,
    totalHuf: booking.totalHuf,
    currency: booking.currency,
    vouchersIssued: vouchers.length,
    invoiceStatus: booking.invoiceStatus,
    invoiceError: booking.invoiceError ?? null,
    invoiceEmailed: Boolean(booking.invoiceEmailSentAt),
    delivery: booking.delivery ?? "email",
    receipt: booking.receipt
      ? {
          status: booking.receipt.status,
          number: booking.receipt.number ?? null,
          error: booking.receipt.error ?? null,
          hasPdf: booking.receipt.status === "issued",
        }
      : null,
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
