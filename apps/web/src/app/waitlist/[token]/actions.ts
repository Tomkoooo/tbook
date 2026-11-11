"use server";

import "@/lib/register-modules";
import { ensureDbConnection } from "@tbook/db";
import { ActionError } from "@tbook/actions";
import { waitlist } from "@tbook/modules";

export interface OfferActionResult {
  ok: boolean;
  message?: string;
  registrationNumber?: string | null;
  checkoutUrl?: string | null;
}

/** The offer link's token is the credential; it resolves to exactly one waitlist entry. */
export async function acceptOfferAction(token: string): Promise<OfferActionResult> {
  try {
    await ensureDbConnection();
    const result = await waitlist.acceptOffer(token);
    if (result.status === "payment") return { ok: true, checkoutUrl: result.checkoutUrl };
    return { ok: true, registrationNumber: result.registrationNumber, message: "Kész! Regisztráltunk, a visszaigazolást e-mailben küldjük." };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, message: error.message };
    console.error("[waitlist accept]", error);
    return { ok: false, message: "Valami hiba történt. Próbáld újra." };
  }
}

export async function declineOfferAction(token: string): Promise<OfferActionResult> {
  try {
    await ensureDbConnection();
    await waitlist.declineOffer(token);
    return { ok: true, message: "Rendben, továbbadtuk a helyet a következőnek. Köszönjük, hogy szóltál!" };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, message: error.message };
    console.error("[waitlist decline]", error);
    return { ok: false, message: "Valami hiba történt. Próbáld újra." };
  }
}
