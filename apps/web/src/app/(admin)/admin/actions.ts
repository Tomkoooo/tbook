"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ActionError } from "@tbook/actions";
import {
  assertUserOrganizationAccess,
  cancelBookingAsAdmin,
  confirmBookingAsAdmin,
  resendVoucherEmailAsAdmin,
  revertCheckInAsAdmin,
  scanVoucherAsAdmin,
} from "@tbook/services";
import { getSessionUser, requireOrgPermission } from "@/lib/admin-auth";
import { activeOrgCookieOptions } from "@/lib/org-cookie";

/**
 * Server actions behind the console's forms.
 *
 * Each one re-checks its permission via requireOrgPermission rather than
 * trusting that the page which rendered the form had already checked: a
 * server action is its own entry point, reachable by anyone who can POST
 * to its id, so page-level gating is a UI affordance and this is the
 * actual enforcement. The v2 API routes exist alongside these for
 * programmatic/mobile clients; the console itself uses these so it needs
 * no client-side fetch layer at all.
 *
 * Every action returns a plain `{ ok }` / `{ error }` result instead of
 * throwing, so a failure renders inline in the form via useActionState
 * rather than as an error page.
 */

export interface ActionResult {
  ok: boolean;
  message?: string;
}

/** Maps a thrown ActionError to the inline result shape; anything else is logged and generalized. */
async function attempt(fn: () => Promise<string>): Promise<ActionResult> {
  try {
    return { ok: true, message: await fn() };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, message: error.message };
    console.error("[admin action]", error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export async function cancelBookingAction(bookingId: string, formData: FormData): Promise<ActionResult> {
  const result = await attempt(async () => {
    const { organizationId } = await requireOrgPermission("booking:manage");
    const reason = String(formData.get("reason") ?? "").trim();
    await cancelBookingAsAdmin(organizationId, bookingId, { reason: reason || undefined });
    return "Booking cancelled. Its entries are void and its capacity has been released.";
  });

  if (result.ok) revalidatePath(`/admin/bookings/${bookingId}`);
  return result;
}

export async function confirmBookingAction(bookingId: string): Promise<ActionResult> {
  const result = await attempt(async () => {
    const { organizationId } = await requireOrgPermission("booking:manage");
    await confirmBookingAsAdmin(organizationId, bookingId);
    return "Booking confirmed.";
  });

  if (result.ok) revalidatePath(`/admin/bookings/${bookingId}`);
  return result;
}

export async function resendEntriesAction(bookingId: string, formData: FormData): Promise<ActionResult> {
  const result = await attempt(async () => {
    const { organizationId } = await requireOrgPermission("voucher:manage");
    const toEmail = String(formData.get("toEmail") ?? "").trim();
    const { sentTo } = await resendVoucherEmailAsAdmin(organizationId, bookingId, { toEmail: toEmail || undefined });
    return `Entries re-sent to ${sentTo}.`;
  });

  if (result.ok) revalidatePath(`/admin/bookings/${bookingId}`);
  return result;
}

export interface ScanActionResult extends ActionResult {
  result?: "valid" | "duplicate" | "invalid" | "wrong_event";
  attendeeName?: string | null;
}

/**
 * Check-in scan. Unlike the others this returns the scan *outcome* rather
 * than a success/failure: "already checked in" and "wrong event" are
 * things the door operator needs to see, not errors.
 */
export async function scanAction(eventId: string, formData: FormData): Promise<ScanActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("voucher:scan");
    const code = String(formData.get("code") ?? "").trim();
    if (!code) return { ok: false, message: "Scan or type a code first." };

    const user = await getSessionUser();
    const outcome = await scanVoucherAsAdmin(organizationId, code, { eventId, userId: user?.id ?? null });

    revalidatePath(`/admin/check-in/${eventId}`);
    return {
      ok: outcome.result === "valid",
      result: outcome.result,
      message: outcome.message,
      attendeeName: outcome.voucher?.displayName ?? null,
    };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, message: error.message };
    console.error("[admin scan]", error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export async function revertCheckInAction(eventId: string, voucherId: string): Promise<ActionResult> {
  const result = await attempt(async () => {
    const { organizationId } = await requireOrgPermission("voucher:manage");
    await revertCheckInAsAdmin(organizationId, voucherId);
    return "Check-in undone.";
  });

  if (result.ok) revalidatePath(`/admin/check-in/${eventId}`);
  return result;
}

/**
 * Switches the console's active organization. Access is verified
 * server-side before the cookie is written, so setting it can never itself
 * grant access to an org the user isn't a member of.
 */
export async function selectOrganizationAction(formData: FormData): Promise<ActionResult> {
  const organizationId = String(formData.get("organizationId") ?? "").trim();

  const result = await attempt(async () => {
    const user = await getSessionUser();
    if (!user) throw ActionError.unauthorized();
    if (!organizationId) throw ActionError.validation("Pick an organization.");

    await assertUserOrganizationAccess(user.id, organizationId, { isSystemAdmin: user.isSystemAdmin });
    (await cookies()).set(activeOrgCookieOptions(organizationId));
    return "Organization selected.";
  });

  // redirect() signals by throwing, so it has to happen outside `attempt`.
  if (result.ok) redirect("/admin");
  return result;
}
