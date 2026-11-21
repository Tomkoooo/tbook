"use server";

import { revalidatePath } from "next/cache";
import { ActionError } from "@tbook/actions";
import { stand } from "@tbook/modules";
import { requireOrgPermission } from "@/lib/admin-auth";
import { toDayDto, type StandDayDto } from "./dto";

/** Running the stand needs stand:operate; products, history and manual days need stand:manage. */

export interface StandResult {
  ok: boolean;
  message?: string;
  day?: StandDayDto;
}

function fail(error: unknown, label: string): StandResult {
  if (error instanceof ActionError) return { ok: false, message: error.message };
  console.error(`[${label}]`, error);
  return { ok: false, message: "Something went wrong. Please try again." };
}

const refresh = () => revalidatePath("/admin/stand", "layout");

export async function openDayAction(eventId: string, devices: boolean, openings: Record<string, number>, sandbox = false): Promise<StandResult> {
  try {
    const { organizationId } = await requireOrgPermission("stand:operate");
    const day = await stand.openDay(organizationId, eventId, { devices, openings, sandbox });
    refresh();
    return { ok: true, day: toDayDto(day) };
  } catch (error) {
    return fail(error, "openDayAction");
  }
}

export type StandChange = { kind: "sell"; method: "cash" | "card" } | { kind: "restock" } | { kind: "internal"; outside: boolean } | { kind: "opening" };

/** One tap: sell / restock / internal use / fix the opening count. Negative `quantity` undoes. */
export async function changeStandAction(dayId: string, productId: string, change: StandChange, quantity: number): Promise<StandResult> {
  try {
    const { organizationId } = await requireOrgPermission("stand:operate");
    const day =
      change.kind === "sell"
        ? await stand.sell(organizationId, dayId, productId, change.method, quantity)
        : change.kind === "restock"
          ? await stand.restock(organizationId, dayId, productId, quantity)
          : change.kind === "internal"
            ? await stand.recordInternal(organizationId, dayId, productId, quantity, change.outside)
            : await stand.setOpening(organizationId, dayId, productId, quantity);
    return { ok: true, day: toDayDto(day) };
  } catch (error) {
    return fail(error, "changeStandAction");
  }
}

/** Only what was entered: a missing value means "leave as it is" (closing) or 0 (a past day). */
export type InternalUse = Record<string, { inside?: number; outside?: number }>;

export async function closeDayAction(dayId: string, counted: Record<string, number>, internal: InternalUse, cashHuf: number | null, note: string, emailTo: string): Promise<StandResult> {
  try {
    const { organizationId } = await requireOrgPermission("stand:operate");
    const result = await stand.closeDay(organizationId, dayId, { counted, internal, cashHuf, note, emailTo });
    refresh();
    const mail = emailTo ? (result.emailed ? ` Report sent to ${emailTo}.` : ` The report email failed: ${result.emailError}`) : "";
    return { ok: true, message: `Day closed.${mail}` };
  } catch (error) {
    return fail(error, "closeDayAction");
  }
}

/** Ends the practice run and throws it away. */
export async function endSandboxAction(dayId: string): Promise<StandResult> {
  try {
    const { organizationId } = await requireOrgPermission("stand:operate");
    await stand.endSandbox(organizationId, dayId);
    refresh();
    return { ok: true, message: "Practice ended." };
  } catch (error) {
    return fail(error, "endSandboxAction");
  }
}

export async function reopenDayAction(dayId: string): Promise<StandResult> {
  try {
    const { organizationId } = await requireOrgPermission("stand:manage");
    await stand.reopenDay(organizationId, dayId);
    refresh();
    return { ok: true, message: "Day reopened." };
  } catch (error) {
    return fail(error, "reopenDayAction");
  }
}

export async function resendReportAction(dayId: string, emailTo: string): Promise<StandResult> {
  try {
    const { organizationId } = await requireOrgPermission("stand:manage");
    const day = await stand.getDayForOrg(organizationId, dayId);
    await stand.sendDayReport(day, emailTo.trim());
    return { ok: true, message: `Report sent to ${emailTo.trim()}.` };
  } catch (error) {
    return fail(error, "resendReportAction");
  }
}

export async function manualDayAction(
  eventId: string,
  date: string,
  closing: Record<string, number>,
  internal: InternalUse,
  cashHuf: number,
  cardHuf: number,
  note: string,
  emailTo: string,
): Promise<StandResult> {
  try {
    const { organizationId } = await requireOrgPermission("stand:manage");
    const result = await stand.recordManualDay(organizationId, eventId, { date, closing, internal, cashHuf, cardHuf, note, emailTo });
    refresh();
    const mail = emailTo ? (result.emailed ? ` Report sent to ${emailTo}.` : ` The report email failed: ${result.emailError}`) : "";
    return { ok: true, message: `Day recorded. The next day can open from it.${mail}` };
  } catch (error) {
    return fail(error, "manualDayAction");
  }
}

export async function saveStandProductAction(eventId: string, productId: string | null, input: stand.StandProductInput): Promise<StandResult> {
  try {
    const { organizationId } = await requireOrgPermission("stand:manage");
    await stand.saveProduct(organizationId, eventId, productId, input);
    refresh();
    return { ok: true, message: "Saved." };
  } catch (error) {
    return fail(error, "saveStandProductAction");
  }
}

export async function deleteStandProductAction(eventId: string, productId: string): Promise<StandResult> {
  try {
    const { organizationId } = await requireOrgPermission("stand:manage");
    const outcome = await stand.deleteProduct(organizationId, eventId, productId);
    refresh();
    return { ok: true, message: outcome === "deleted" ? "Deleted." : "It was sold on past days, so it was switched off instead of deleted." };
  } catch (error) {
    return fail(error, "deleteStandProductAction");
  }
}

/** Adds a product created after the day opened. */
export async function addProductToDayAction(dayId: string, productId: string, opening: number): Promise<StandResult> {
  try {
    const { organizationId } = await requireOrgPermission("stand:operate");
    return { ok: true, day: toDayDto(await stand.addProductToDay(organizationId, dayId, productId, opening)) };
  } catch (error) {
    return fail(error, "addProductToDayAction");
  }
}
