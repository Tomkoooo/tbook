"use server";

import { ActionError } from "@tbook/actions";
import { guestPortal } from "@tbook/modules";
import { checkRegistrationAnswers, getEventForOrg, prefillRegistration, scanVoucherAsAdmin } from "@tbook/services";
import type { AttendeeFieldValue } from "@tbook/schemas";
import { requireOrgPermission } from "@/lib/admin-auth";
import type { ScanActionResult } from "../actions";

/**
 * Preview page actions. Every one of them only reads: the form is checked
 * but not registered, a scan is a lookup (no check-in), the guest view is
 * what the guest API would return. Anyone who can see the event may try them.
 */

export interface PreviewResult<T> {
  ok: boolean;
  message?: string;
  /** One line per problem the checks found. */
  issues?: string[];
  data?: T;
}

function fail<T>(error: unknown, label: string): PreviewResult<T> {
  if (error instanceof ActionError) {
    const raw = (error.details as { issues?: unknown[] } | undefined)?.issues ?? [];
    const issues = raw.map((issue) => {
      const item = issue as { message?: string; fieldKey?: string; reason?: string };
      return item.message ?? [item.fieldKey, item.reason].filter(Boolean).join(": ");
    });
    return { ok: false, message: error.message, issues };
  }
  console.error(`[${label}]`, error);
  return { ok: false, message: "Something went wrong. Please try again." };
}

async function eventInOrg(eventId: string) {
  const { organizationId } = await requireOrgPermission("event:read");
  await getEventForOrg(organizationId, eventId);
  return organizationId;
}

/** What POST /events/{id}/prefill returns for this code. */
export async function previewPrefillAction(eventId: string, code: string) {
  try {
    await eventInOrg(eventId);
    return { ok: true, data: await prefillRegistration(eventId, code) } as PreviewResult<Awaited<ReturnType<typeof prefillRegistration>>>;
  } catch (error) {
    return fail<Awaited<ReturnType<typeof prefillRegistration>>>(error, "previewPrefillAction");
  }
}

/** Runs every registration check on the answers (form, rules, unique IDs) without registering. */
export async function previewCheckAction(eventId: string, fields: Record<string, AttendeeFieldValue>): Promise<PreviewResult<null>> {
  try {
    await eventInOrg(eventId);
    await checkRegistrationAnswers(eventId, 1, [{ fields }]);
    return { ok: true, message: "Every check passed. On the website this would register the guest." };
  } catch (error) {
    return fail(error, "previewCheckAction");
  }
}

/** The door scanner's answer for a code, as a lookup: nobody is checked in. */
export async function previewScanAction(eventId: string, formData: FormData): Promise<ScanActionResult> {
  try {
    const organizationId = await eventInOrg(eventId);
    const code = String(formData.get("code") ?? "").trim();
    if (!code) return { ok: false, message: "Scan or type a code first." };
    const dayRaw = String(formData.get("day") ?? "").trim();
    const day = dayRaw === "any" || /^\d{4}-\d{2}-\d{2}$/.test(dayRaw) ? dayRaw : undefined;
    const outcome = await scanVoucherAsAdmin(organizationId, code, { eventId, day, mode: "lookup" });
    return {
      ok: outcome.result === "valid",
      result: outcome.result,
      message: outcome.result === "valid" ? "Preview — would be admitted. Not checked in." : outcome.message,
      attendeeName: outcome.voucher?.displayName ?? null,
      validDate: outcome.voucher?.validDate ?? null,
      tags: [...(outcome.voucher?.tags ?? [])],
    };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, message: error.message };
    console.error("[previewScanAction]", error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

/** What the guest self-service API returns for this code. */
export async function previewGuestAction(eventId: string, code: string): Promise<PreviewResult<guestPortal.GuestView>> {
  try {
    await eventInOrg(eventId);
    return { ok: true, data: await guestPortal.lookupGuest(eventId, code, null) };
  } catch (error) {
    return fail(error, "previewGuestAction");
  }
}

/** Stands in for a save (boarding tap, kiosk answer) in the preview: accepts it and stores nothing. */
export async function previewNoSaveAction(): Promise<{ ok: boolean }> {
  await requireOrgPermission("event:read");
  return { ok: true };
}
