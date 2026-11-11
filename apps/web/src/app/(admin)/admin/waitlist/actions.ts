"use server";

import { revalidatePath } from "next/cache";
import { ActionError } from "@tbook/actions";
import { waitlist } from "@tbook/modules";
import { requireOrgPermission } from "@/lib/admin-auth";

export interface WaitlistActionResult {
  ok: boolean;
  message?: string;
}

function fail(error: unknown, label: string): WaitlistActionResult {
  if (error instanceof ActionError) return { ok: false, message: error.message };
  console.error(`[${label}]`, error);
  return { ok: false, message: "Something went wrong. Please try again." };
}

/** Fills free places now (e.g. after raising the capacity). */
export async function processWaitlistAction(eventId: string): Promise<WaitlistActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("waitlist:manage");
    await waitlist.processWaitlistForOrg(organizationId, eventId);
    revalidatePath("/admin/waitlist");
    return { ok: true, message: "Waitlist processed." };
  } catch (error) {
    return fail(error, "processWaitlistAction");
  }
}

export async function removeWaitlistEntryAction(entryId: string): Promise<WaitlistActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("waitlist:manage");
    await waitlist.removeWaitlistEntry(organizationId, entryId);
    revalidatePath("/admin/waitlist");
    return { ok: true, message: "Removed from the waitlist." };
  } catch (error) {
    return fail(error, "removeWaitlistEntryAction");
  }
}
