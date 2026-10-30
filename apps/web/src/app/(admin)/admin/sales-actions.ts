"use server";

import { revalidatePath } from "next/cache";
import { ActionError, parseInput } from "@tbook/actions";
import { createPosSale, type PosSaleResult } from "@tbook/services";
import { billingInfoSchema, customerSchema, posPaymentMethodSchema } from "@tbook/schemas";
import { z } from "zod";
import { getSessionUser, requireOrgPermission } from "@/lib/admin-auth";
import { parseAttendeesFromForm } from "@/lib/attendee-form";

export interface PosSaleActionResult {
  ok: boolean;
  message?: string;
  sale?: PosSaleResult;
}

const posFormSchema = z.object({
  eventId: z.string().min(1),
  tickets: z.number().int().min(1).max(50),
  customer: customerSchema,
  billing: billingInfoSchema,
  paymentMethod: posPaymentMethodSchema,
  reference: z.string().max(200).default(""),
  note: z.string().max(1000).default(""),
});

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

    const tickets = Math.max(Number(formData.get("tickets") ?? 1) || 1, 1);
    const str = (key: string) => String(formData.get(key) ?? "").trim();
    const company = formData.get("billingCompany") !== null;

    const input = parseInput(posFormSchema, {
      eventId: str("eventId"),
      tickets,
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
      paymentMethod: str("paymentMethod"),
      reference: str("reference"),
      note: str("note"),
    });

    const sale = await createPosSale(
      organizationId,
      { ...input, attendees: parseAttendeesFromForm(formData, tickets) },
      { userId: user?.id ?? null },
    );

    revalidatePath("/admin/bookings");
    return { ok: true, sale };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, message: error.message };
    console.error("[pos sale]", error);
    return { ok: false, message: "Something went wrong. The sale was not recorded — check Bookings before retrying." };
  }
}
