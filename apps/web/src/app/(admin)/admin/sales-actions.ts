"use server";

import { revalidatePath } from "next/cache";
import { ActionError, parseInput } from "@tbook/actions";
import {
  cancelSumUpCardSale,
  buildPosSaleResult,
  createPosSale,
  issueReceiptForBooking,
  settleSumUpCheckout,
  startSumUpCardSale,
  type CardSaleState,
  type PosSaleResult,
} from "@tbook/services";
import { billingInfoSchema, customerSchema, posPaymentMethodSchema } from "@tbook/schemas";
import { z } from "zod";
import { getSessionUser, requireOrgPermission } from "@/lib/admin-auth";
import { parseAttendeesFromForm } from "@/lib/attendee-form";

export interface PosSaleActionResult {
  ok: boolean;
  message?: string;
  sale?: PosSaleResult;
}

const saleBase = {
  eventId: z.string().min(1),
  tickets: z.number().int().min(1).max(50),
  paymentMethod: posPaymentMethodSchema,
  reference: z.string().max(200).default(""),
  note: z.string().max(1000).default(""),
};

/** "email": customer + billing required (ticket and invoice are emailed). "receipt": walk-in, only an optional name. */
const posFormSchema = z.discriminatedUnion("delivery", [
  z.object({ ...saleBase, delivery: z.literal("email"), customer: customerSchema, billing: billingInfoSchema }),
  z.object({ ...saleBase, delivery: z.literal("receipt"), customer: z.object({ name: z.string().max(200).default("") }) }),
]);

/**
 * A seller needs `sale:create`; a console manager (`booking:manage`) may
 * sell too, which also keeps existing Owner roles working — they were
 * stored before `sale:create` existed.
 */
async function requireSellerContext() {
  try {
    return await requireOrgPermission("sale:create");
  } catch (error) {
    if (error instanceof ActionError && error.message.includes("permission")) return requireOrgPermission("booking:manage");
    throw error;
  }
}

export async function createPosSaleAction(formData: FormData): Promise<PosSaleActionResult> {
  try {
    const { organizationId } = await requireSellerContext();
    const user = await getSessionUser();

    const input = parseSaleForm(formData, String(formData.get("paymentMethod") ?? ""));
    const sale = await createPosSale(organizationId, input, { userId: user?.id ?? null });

    revalidatePath("/admin/bookings");
    return { ok: true, sale };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, message: error.message };
    console.error("[pos sale]", error);
    return { ok: false, message: "Something went wrong. The sale was not recorded — check Bookings before retrying." };
  }
}

/* ---- Card payment on a SumUp reader --------------------------------- */

export interface CardSaleActionResult {
  ok: boolean;
  message?: string;
  state?: CardSaleState["state"];
  sale?: PosSaleResult;
  bookingId?: string;
  reason?: string;
}

function cardResult(outcome: CardSaleState, bookingId: string): CardSaleActionResult {
  switch (outcome.state) {
    case "paid":
      return { ok: true, state: "paid", bookingId, sale: outcome.sale };
    case "waiting":
      return { ok: true, state: "waiting", bookingId };
    case "cancelled":
      return { ok: false, state: "cancelled", bookingId, message: "The card payment was cancelled. No sale was recorded." };
    case "failed":
      return { ok: false, state: "failed", bookingId, message: `${outcome.reason} No sale was recorded.` };
    case "mismatch":
      return {
        ok: false,
        state: "mismatch",
        bookingId,
        message: `${outcome.reason} The sale was NOT completed — open the booking and resolve it before taking another payment.`,
      };
  }
}

/** Reads a sale form (cash, manual card or SumUp reader; emailed or walk-in). */
function parseSaleForm(formData: FormData, paymentMethod: string) {
  const tickets = Math.max(Number(formData.get("tickets") ?? 1) || 1, 1);
  const str = (key: string) => String(formData.get(key) ?? "").trim();
  const company = formData.get("billingCompany") !== null;
  const delivery = str("delivery") === "receipt" ? "receipt" : "email";

  // Day-pass baskets arrive as JSON; the server re-derives the count and price from them.
  let selections: Record<string, Record<string, number>> | undefined;
  const rawBasket = str("dayPasses");
  if (rawBasket) {
    try {
      selections = { dayPasses: JSON.parse(rawBasket) as Record<string, number> };
    } catch {
      throw ActionError.validation("Could not read the selected days.");
    }
  }

  const base = { eventId: str("eventId"), tickets, paymentMethod, reference: str("reference"), note: str("note") };
  const input = parseInput(
    posFormSchema,
    delivery === "receipt"
      ? { ...base, delivery, customer: { name: str("customer.name") } }
      : {
          ...base,
          delivery,
          customer: { name: str("customer.name"), email: str("customer.email"), phone: str("customer.phone"), note: "" },
          billing: {
            billingType: company ? "company" : "personal",
            // Private buyers are invoiced in the customer's own name unless the seller typed another.
            name: str("billing.name") || str("customer.name"),
            zip: str("billing.zip"),
            city: str("billing.city"),
            street: str("billing.street"),
            countryCode: str("billing.countryCode") || "HU",
            taxNumber: company ? str("billing.taxNumber") : "",
          },
        },
  );

  return { ...input, selections, attendees: parseAttendeesFromForm(formData, tickets) };
}

/** Pushes the amount to a paired SumUp reader and leaves the sale waiting for the customer. */
export async function startCardSaleAction(formData: FormData): Promise<CardSaleActionResult> {
  try {
    const { organizationId } = await requireSellerContext();
    const user = await getSessionUser();
    const readerId = String(formData.get("readerId") ?? "").trim();
    if (!readerId) return { ok: false, message: "Choose a reader." };

    const { bookingId } = await startSumUpCardSale(
      organizationId,
      { ...parseSaleForm(formData, "card"), readerId },
      { userId: user?.id ?? null },
    );
    revalidatePath("/admin/bookings");
    return { ok: true, state: "waiting", bookingId };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, message: error.message };
    console.error("[pos card sale]", error);
    return { ok: false, message: "Something went wrong. Check Bookings before retrying." };
  }
}

/** Polled by the seller's screen while the customer pays; also settles the sale if the webhook never arrived. */
export async function pollCardSaleAction(bookingId: string): Promise<CardSaleActionResult> {
  try {
    const { organizationId } = await requireSellerContext();
    await assertBookingInOrg(organizationId, bookingId);
    const outcome = await settleSumUpCheckout(bookingId);
    if (outcome.state === "paid") revalidatePath("/admin/bookings");
    return cardResult(outcome, bookingId);
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, message: error.message };
    console.error("[pos card poll]", error);
    return { ok: false, message: "Could not check the payment. Try again." };
  }
}

export async function cancelCardSaleAction(bookingId: string): Promise<CardSaleActionResult> {
  try {
    const { organizationId } = await requireSellerContext();
    const outcome = await cancelSumUpCardSale(organizationId, bookingId);
    revalidatePath("/admin/bookings");
    return cardResult(outcome, bookingId);
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, message: error.message };
    console.error("[pos card cancel]", error);
    return { ok: false, message: "Could not cancel. Check the reader and Bookings." };
  }
}

/** A seller may only poll sales of their own organization. */
async function assertBookingInOrg(organizationId: string, bookingId: string): Promise<void> {
  const { bookingRepository } = await import("@tbook/db");
  const booking = await bookingRepository.findById(bookingId);
  if (!booking || String(booking.organizationId) !== organizationId) throw ActionError.notFound("Booking not found");
}

/** Re-tries a walk-in sale's Számlázz.hu receipt (after a network error or a settings fix). */
export async function retryReceiptAction(bookingId: string): Promise<PosSaleActionResult> {
  try {
    const { organizationId } = await requireSellerContext();
    await assertBookingInOrg(organizationId, bookingId);
    await issueReceiptForBooking(bookingId);
    const sale = await buildPosSaleResult(bookingId);
    revalidatePath(`/admin/bookings/${bookingId}`);
    return sale.receipt?.status === "issued"
      ? { ok: true, sale, message: `Receipt ${sale.receipt.number} issued.` }
      : { ok: false, sale, message: sale.receipt?.error ?? "The receipt could not be issued." };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, message: error.message };
    console.error("[pos receipt retry]", error);
    return { ok: false, message: "Something went wrong. Try again." };
  }
}
