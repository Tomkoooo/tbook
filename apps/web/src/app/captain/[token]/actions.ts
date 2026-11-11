"use server";

import "@/lib/register-modules";
import { revalidatePath } from "next/cache";
import { ActionError } from "@tbook/actions";
import { BUS_TRANSPORT, busTransport } from "@tbook/modules";
import { resolveModules } from "@tbook/services";

/**
 * The captain's only write: boarding of a passenger on their own bus. The
 * link token is the credential; it resolves to exactly one route, and
 * setBoarding refuses anyone not booked on it.
 */
export async function captainSetBoardingAction(
  token: string,
  attendeeKey: string,
  leg: "outbound" | "return",
  status: "boarded" | "not_boarded" | null,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const route = await busTransport.findRouteByCaptainToken(token);
    if (!route) return { ok: false, message: "Ez a link már nem érvényes. Kérj újat a szervezőtől." };
    if (!(await resolveModules({ eventId: String(route.eventId) })).isOn(BUS_TRANSPORT)) return { ok: false, message: "A buszos funkció ki van kapcsolva." };
    if (!["outbound", "return"].includes(leg)) return { ok: false, message: "Ismeretlen út." };
    if (status !== null && !["boarded", "not_boarded"].includes(status)) return { ok: false, message: "Ismeretlen állapot." };
    await busTransport.setBoarding(route, attendeeKey, leg, status, `captain:${route.code}`);
    revalidatePath(`/captain/${token}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, message: error.message };
    console.error("[captainSetBoardingAction]", error);
    return { ok: false, message: "Nem sikerült menteni. Próbáld újra." };
  }
}
