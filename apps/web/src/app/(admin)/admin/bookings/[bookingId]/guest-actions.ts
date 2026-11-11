"use server";

import { revalidatePath } from "next/cache";
import { ActionError } from "@tbook/actions";
import { cancelBookingAttendee, getBookingDetailForOrg, setAttendeeTags } from "@tbook/services";
import { requireOrgPermission } from "@/lib/admin-auth";

/** Per-guest changes on one booking: tags and cancelling one guest of a group. booking:manage. */

export interface GuestActionResult {
  ok: boolean;
  message?: string;
}

function fail(error: unknown, label: string): GuestActionResult {
  if (error instanceof ActionError) return { ok: false, message: error.message };
  console.error(`[${label}]`, error);
  return { ok: false, message: "Something went wrong. Please try again." };
}

export async function setGuestTagsAction(bookingId: string, attendeeIndex: number, tags: string[]): Promise<GuestActionResult> {
  try {
    const { organizationId, userId } = await requireOrgPermission("booking:manage");
    await setAttendeeTags(organizationId, bookingId, attendeeIndex, tags, `admin:${userId}`);
    revalidatePath(`/admin/bookings/${bookingId}`);
    return { ok: true, message: "Tags saved." };
  } catch (error) {
    return fail(error, "setGuestTagsAction");
  }
}

export async function cancelGuestAction(bookingId: string, attendeeIndex: number, reason: string): Promise<GuestActionResult> {
  try {
    const { organizationId, userId } = await requireOrgPermission("booking:manage");
    await getBookingDetailForOrg(organizationId, bookingId); // org scope check
    await cancelBookingAttendee(bookingId, attendeeIndex, { by: `admin:${userId}`, reason: reason.trim().slice(0, 500), allowPaid: true });
    revalidatePath(`/admin/bookings/${bookingId}`);
    return { ok: true, message: "Guest cancelled. Their entry is void and their seat is free again." };
  } catch (error) {
    return fail(error, "cancelGuestAction");
  }
}
