import { randomBytes, randomUUID } from "node:crypto";
import { ActionError } from "@tbook/actions";
import { fieldClaimRepository } from "@tbook/db";
import { formatRegistrationNumber, isFieldVisible, normalizeUniqueValue } from "@tbook/domain";
import type { AttendeeFieldDef, BookingAttendee } from "@tbook/schemas";
import { extensions, type BookingReleaseReason, type DynamicChoice, type EventContext } from "./extensions";

/**
 * The registration steps added on top of createPendingBooking's field and
 * eligibility validation: module-supplied choices, `unique` field claims,
 * module reservations (bus seats, …) and registration numbers. Each step
 * is driven by the event's own form definition and the registered
 * extensions — nothing here knows about a particular module.
 */

export interface ResolvedFieldChoices {
  /** The schema with every `choicesSource` select filled with its live choices (selectable ones only). */
  schema: AttendeeFieldDef[];
  /** Full choice details per field key, including full/disabled ones — for the storefront. */
  details: Record<string, DynamicChoice[]>;
}

/** Fills `choicesSource` selects from their providers. A provider whose module is off yields no choices. */
export async function resolveFieldChoices(schema: AttendeeFieldDef[], ctx: EventContext): Promise<ResolvedFieldChoices> {
  const details: Record<string, DynamicChoice[]> = {};
  const resolved: AttendeeFieldDef[] = [];
  // Field defs may be Mongoose subdocuments; spreading one copies its
  // internals, not its fields — so work on plain objects.
  const plain = schema.map((field) => (typeof (field as { toObject?: () => AttendeeFieldDef }).toObject === "function" ? (field as unknown as { toObject: () => AttendeeFieldDef }).toObject() : field));
  for (const field of plain) {
    if (field.type !== "select" || !field.choicesSource) {
      resolved.push(field);
      continue;
    }
    const provider = extensions.choiceProvider(field.choicesSource);
    const choices = provider && ctx.modules.isOn(provider.moduleKey) ? await provider.list(ctx) : [];
    details[field.key] = choices;
    resolved.push({ ...field, choices: choices.filter((choice) => !choice.disabled).map((choice) => ({ value: choice.value, label: choice.label })) });
  }
  return { schema: resolved, details };
}

/**
 * Claims every `unique` field value of the new booking's attendees. Two
 * attendees in one booking with the same value are refused too. Throws a
 * validation error naming the attendee; returns the release step.
 */
export async function claimUniqueFieldValues(
  ctx: EventContext,
  bookingId: string,
  attendees: BookingAttendee[],
  schema: AttendeeFieldDef[],
): Promise<() => Promise<void>> {
  const uniqueFields = schema.filter((field) => field.unique);
  if (uniqueFields.length === 0) return async () => {};

  const claims: Array<{ fieldKey: string; value: string; index: number; label: string }> = [];
  const seen = new Map<string, number>();
  attendees.forEach((attendee, index) => {
    for (const field of uniqueFields) {
      if (!isFieldVisible(field, attendee.fields ?? {})) continue;
      const value = normalizeUniqueValue(attendee.fields?.[field.key]);
      if (!value) continue;
      const seenKey = `${field.key}\u0000${value}`;
      if (seen.has(seenKey)) {
        throw ActionError.validation(`The same ${field.label} is entered twice in this registration.`, {
          issues: [{ index, fieldKey: field.key, reason: "field_duplicate", details: { otherIndex: seen.get(seenKey) } }],
        });
      }
      seen.set(seenKey, index);
      claims.push({ fieldKey: field.key, value, index, label: field.label });
    }
  });
  if (claims.length === 0) return async () => {};

  const clash = await fieldClaimRepository.claimAll(
    { organizationId: ctx.organizationId, eventId: String(ctx.event._id), bookingId },
    claims.map(({ fieldKey, value }) => ({ fieldKey, value })),
  );
  if (clash) {
    const claim = claims.find((c) => c.fieldKey === clash.fieldKey && c.value === clash.value)!;
    throw ActionError.validation(`This ${claim.label} is already registered for this event.`, {
      issues: [{ index: claim.index, fieldKey: claim.fieldKey, reason: "field_taken" }],
    });
  }
  return () => fieldClaimRepository.releaseForBooking(bookingId);
}

/** Runs every module reservation in turn; if one refuses, the earlier ones are released. */
export async function runRegistrationReservers(
  ctx: EventContext,
  bookingId: string,
  attendees: BookingAttendee[],
  fieldSchema: AttendeeFieldDef[],
): Promise<() => Promise<void>> {
  const releases: Array<() => Promise<void>> = [];
  const releaseAll = async () => {
    for (const release of releases.reverse()) {
      try {
        await release();
      } catch (error) {
        console.error("[tbook] reservation release failed", bookingId, error);
      }
    }
  };
  try {
    for (const reserver of extensions.registrationReservers()) {
      const result = await reserver({ ...ctx, bookingId, attendees, fieldSchema });
      if (result) releases.push(result.release);
    }
  } catch (error) {
    await releaseAll();
    throw error;
  }
  return releaseAll;
}

export function newRegistrationNumber(): string {
  return formatRegistrationNumber(randomBytes(8));
}

/** Gives each attendee a stable id and registration number (overwriting anything the client sent). */
export function assignAttendeeIdentity(attendees: BookingAttendee[]): BookingAttendee[] {
  return attendees.map((attendee) => ({ ...attendee, id: randomUUID(), registrationNumber: newRegistrationNumber() }));
}

/** Gives back what a booking held in modules and unique claims (cancel / expire). */
/** Runs the modules' release hooks only (no unique-claim changes). */
export async function releaseHooksOnly(booking: Parameters<ReturnType<typeof extensions.bookingReleasedHooks>[number]>[0], reason: BookingReleaseReason): Promise<void> {
  for (const hook of extensions.bookingReleasedHooks()) {
    try {
      await hook(booking, reason);
    } catch (error) {
      console.error("[tbook] booking released hook failed", String(booking._id), error);
    }
  }
}

export async function releaseBookingExtensions(booking: Parameters<ReturnType<typeof extensions.bookingReleasedHooks>[number]>[0], reason: BookingReleaseReason): Promise<void> {
  try {
    await fieldClaimRepository.releaseForBooking(String(booking._id));
  } catch (error) {
    console.error("[tbook] releasing unique claims failed", String(booking._id), error);
  }
  for (const hook of extensions.bookingReleasedHooks()) {
    try {
      await hook(booking, reason);
    } catch (error) {
      console.error("[tbook] booking released hook failed", String(booking._id), error);
    }
  }
}
