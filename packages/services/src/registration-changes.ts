import { ActionError } from "@tbook/actions";
import { BookingModel, eventRepository, fieldClaimRepository, voucherRepository, type IBooking, type IEvent } from "@tbook/db";
import { collectListLookups, isCheckboxChecked, isFieldVisible, normalizeUniqueValue, validateEligibility, type EligibilityRulesConfig } from "@tbook/domain";
import type { AttendeeFieldDef, AttendeeFieldValue, BookingAttendee, BookingChange } from "@tbook/schemas";
import { cancelBooking } from "./booking-service";
import { attendeeIssuesMessage, eligibilityIssuesMessage, normalizeAttendeePayload, validateAttendees } from "./booking-validation";
import { loadDataListMembership } from "./data-list-service";
import type { EventContext } from "./extensions";
import { resolveModules } from "./module-registry";
import { refreshVoucherNames } from "./registration-admin-service";
import { claimUniqueFieldValues, releaseHooksOnly, resolveFieldChoices, runRegistrationReservers } from "./registration-pipeline";

/**
 * Changing a registration after it was made — by an organizer or by the
 * guest themselves — with the same guarantees as registering: answers are
 * validated against the live form (module options included), registration
 * rules are re-checked, `unique` answers and module reservations (bus
 * seats) are moved over, and every change is kept in the booking's
 * change log. Nothing is deleted: a guest who leaves a group registration
 * is moved to `cancelledAttendees`.
 */

const ACTIVE_STATUSES = new Set(["paid", "confirmed"]);

function plain<T>(value: T): T {
  return typeof (value as { toObject?: () => T }).toObject === "function" ? (value as unknown as { toObject: () => T }).toObject() : value;
}

export async function bookingEventContext(booking: IBooking): Promise<{ event: IEvent; ctx: EventContext }> {
  const event = await eventRepository.findById(String(booking.eventId));
  if (!event) throw ActionError.notFound("Event not found");
  const organizationId = booking.organizationId ? String(booking.organizationId) : event.organizationId ? String(event.organizationId) : null;
  const groupId = event.groupId ? String(event.groupId) : null;
  const modules = await resolveModules({ organizationId, groupId, event });
  return { event, ctx: { event, organizationId, groupId, modules } };
}

/**
 * The booking's form with module-fed options filled in live. Every option
 * is accepted here, full ones included: the reservation step decides
 * whether a change fits (a guest keeping their full bus must still pass).
 */
export async function editableFieldSchema(booking: IBooking, ctx: EventContext): Promise<AttendeeFieldDef[]> {
  const stored = (booking.attendeeFieldSchema ?? []).map((field) => plain(field) as AttendeeFieldDef);
  const { schema, details } = await resolveFieldChoices(stored, ctx);
  return schema.map((field) =>
    details[field.key] ? { ...field, choices: details[field.key]!.map((choice) => ({ value: choice.value, label: choice.label })) } : field,
  );
}

function displayValue(field: AttendeeFieldDef | undefined, raw: AttendeeFieldValue | undefined): string {
  if (raw == null || raw === "") return "";
  if (field?.type === "checkbox") return isCheckboxChecked(raw) ? "✓" : "";
  if (field?.type === "select") return field.choices?.find((choice) => choice.value === String(raw))?.label ?? String(raw);
  return String(raw);
}

function diffFields(schema: AttendeeFieldDef[], before: Record<string, AttendeeFieldValue> = {}, after: Record<string, AttendeeFieldValue> = {}, prefix = ""): BookingChange["changes"] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: BookingChange["changes"] = [];
  for (const key of keys) {
    const field = schema.find((f) => f.key === key);
    const a = displayValue(field, before[key]);
    const b = displayValue(field, after[key]);
    if (a !== b) changes.push({ field: `${prefix}${field?.label ?? key}`, before: a, after: b });
  }
  return changes;
}

function diffAttendee(schema: AttendeeFieldDef[], memberSchema: AttendeeFieldDef[], before: BookingAttendee, after: BookingAttendee): BookingChange["changes"] {
  const changes = diffFields(schema, before.fields, after.fields);
  const count = Math.max(before.members?.length ?? 0, after.members?.length ?? 0);
  for (let i = 0; i < count; i += 1) {
    changes.push(...diffFields(memberSchema, before.members?.[i]?.fields, after.members?.[i]?.fields, `Player ${i + 1}: `));
  }
  return changes;
}

function uniqueClaimsOf(schema: AttendeeFieldDef[], attendees: BookingAttendee[]) {
  const claims: Array<{ fieldKey: string; value: string }> = [];
  for (const attendee of attendees) {
    for (const field of schema.filter((f) => f.unique)) {
      if (!isFieldVisible(field, attendee.fields ?? {})) continue;
      const value = normalizeUniqueValue(attendee.fields?.[field.key]);
      if (value) claims.push({ fieldKey: field.key, value });
    }
  }
  return claims;
}

export interface ReplaceAttendeesOptions {
  /** "guest", "admin:<userId>", "system". */
  by: string;
  /** Skip the registration rules (organizers may override them). */
  skipEligibility?: boolean;
  /** Rename tickets after the change (default); a caller that reports the count does it itself. */
  refreshVouchers?: boolean;
}

/**
 * Replaces a booking's attendee answers. Attendee ids, registration
 * numbers and tags are kept by position (the caller sends answers only).
 */
export async function replaceBookingAttendees(bookingId: string, incoming: BookingAttendee[], opts: ReplaceAttendeesOptions): Promise<IBooking> {
  const booking = await BookingModel.findById(bookingId).exec();
  if (!booking) throw ActionError.notFound("Booking not found");
  const { event, ctx } = await bookingEventContext(booking);
  const schema = await editableFieldSchema(booking, ctx);
  const memberSchema = (booking.teamMemberFieldSchema ?? []).map((f) => plain(f) as AttendeeFieldDef);
  const previous = (booking.attendees ?? []).map((attendee) => plain(attendee) as BookingAttendee);

  const issues = validateAttendees(schema, booking.guests, incoming, memberSchema.length > 0 ? "team" : "person", {
    teamMemberFieldSchema: memberSchema,
    teamMemberLimit: booking.teamMemberLimit ?? null,
    playersPerTicket: (booking.playersPerTicket ?? 1) > 1 ? booking.playersPerTicket : null,
  });
  if (issues.length > 0) throw ActionError.validation(attendeeIssuesMessage(issues, schema), { issues });

  const next = normalizeAttendeePayload(schema, incoming, memberSchema).map((attendee, index) => {
    const old = previous[index];
    return { ...attendee, id: old?.id ?? attendee.id, registrationNumber: old?.registrationNumber ?? attendee.registrationNumber, tags: old?.tags };
  });

  if (!opts.skipEligibility) {
    const eligibilityEvent = { ...plain(event), eligibilityFormRules: event.eligibilityFormRules as EligibilityRulesConfig | null };
    const eligibilityIssues = validateEligibility(eligibilityEvent, next, schema, memberSchema, null, {
      listMembership: await loadDataListMembership(ctx.organizationId, collectListLookups(eligibilityEvent, next)),
    });
    if (eligibilityIssues.length > 0) throw ActionError.validation(eligibilityIssuesMessage(eligibilityIssues), { issues: eligibilityIssues });
  }

  const changeLog: BookingChange[] = [];
  next.forEach((attendee, index) => {
    const before = previous[index];
    const changes = before ? diffAttendee(schema, memberSchema, before, attendee) : [];
    if (changes.length > 0) {
      changeLog.push({ at: new Date(), by: opts.by, action: "edited", attendeeId: attendee.id ?? null, registrationNumber: attendee.registrationNumber ?? null, changes });
    }
  });
  if (changeLog.length === 0) return booking;

  const active = ACTIVE_STATUSES.has(booking.status) || booking.status === "pending" || booking.status === "checkout_started";
  if (active) await moveHoldings(booking, ctx, previous, next, schema);

  const updated = await BookingModel.findByIdAndUpdate(
    bookingId,
    { $set: { attendees: next }, $push: { changeLog: { $each: changeLog } } },
    { returnDocument: "after" },
  ).exec();
  if (opts.refreshVouchers !== false) await refreshVoucherNames(bookingId, updated!);
  return updated!;
}

/**
 * Moves unique-answer claims and module reservations from the old
 * attendee list to the new one. All or nothing: if the new list doesn't
 * fit (ID taken, bus full) the old holdings are restored and it throws.
 */
async function moveHoldings(booking: IBooking, ctx: EventContext, previous: BookingAttendee[], next: BookingAttendee[], schema: AttendeeFieldDef[]): Promise<void> {
  const bookingId = String(booking._id);
  const oldClaims = uniqueClaimsOf(schema, previous);
  const asBooking = (attendees: BookingAttendee[]) => ({ ...plain(booking), _id: booking._id, attendees }) as unknown as IBooking;

  await fieldClaimRepository.releaseForBooking(bookingId);
  try {
    await claimUniqueFieldValues(ctx, bookingId, next, schema);
  } catch (error) {
    await fieldClaimRepository.claimAll({ organizationId: ctx.organizationId, eventId: String(booking.eventId), bookingId }, oldClaims);
    throw error;
  }

  await releaseHooksOnly(asBooking(previous), "edited");
  try {
    await runRegistrationReservers(ctx, bookingId, next, schema);
  } catch (error) {
    await runRegistrationReservers(ctx, bookingId, previous, schema).catch((restoreError) =>
      console.error("[tbook] restoring reservations after a refused edit failed", bookingId, restoreError),
    );
    await fieldClaimRepository.releaseForBooking(bookingId);
    await fieldClaimRepository.claimAll({ organizationId: ctx.organizationId, eventId: String(booking.eventId), bookingId }, oldClaims);
    throw error;
  }
}

/** Edits one attendee's answers; `lockedKeys` keep their stored value (e.g. the guest's own ID). */
export async function editBookingAttendee(
  bookingId: string,
  attendeeIndex: number,
  fields: Record<string, AttendeeFieldValue>,
  opts: ReplaceAttendeesOptions & { lockedKeys?: string[] },
): Promise<IBooking> {
  const booking = await BookingModel.findById(bookingId).exec();
  if (!booking) throw ActionError.notFound("Booking not found");
  if (!ACTIVE_STATUSES.has(booking.status)) throw ActionError.validation("Only a confirmed registration can be changed.");
  const attendees = (booking.attendees ?? []).map((a) => plain(a) as BookingAttendee);
  const current = attendees[attendeeIndex];
  if (!current) throw ActionError.notFound("Guest not found");
  const merged = { ...current.fields, ...fields };
  for (const key of opts.lockedKeys ?? []) {
    if (key in (current.fields ?? {})) merged[key] = current.fields[key]!;
    else delete merged[key];
  }
  attendees[attendeeIndex] = { ...current, fields: merged };
  return replaceBookingAttendees(bookingId, attendees, opts);
}

/**
 * Cancels one guest of a registration. The last guest cancels the whole
 * booking. Only free registrations: a paid booking's refund is an
 * organizer's decision (cancel it from the console).
 */
export async function cancelBookingAttendee(bookingId: string, attendeeIndex: number, opts: { by: string; reason?: string; allowPaid?: boolean }): Promise<IBooking> {
  const booking = await BookingModel.findById(bookingId).exec();
  if (!booking) throw ActionError.notFound("Booking not found");
  if (!ACTIVE_STATUSES.has(booking.status)) throw ActionError.validation("This registration is no longer active.");
  if (booking.totalHuf > 0 && !opts.allowPaid) throw ActionError.validation("A paid registration can only be cancelled by the organizer.");
  const attendees = (booking.attendees ?? []).map((a) => plain(a) as BookingAttendee);
  const removed = attendees[attendeeIndex];
  if (!removed) throw ActionError.notFound("Guest not found");
  const entry: BookingChange = {
    at: new Date(),
    by: opts.by,
    action: attendees.length === 1 ? "booking_cancelled" : "attendee_cancelled",
    attendeeId: removed.id ?? null,
    registrationNumber: removed.registrationNumber ?? null,
    changes: [],
  };

  if (attendees.length === 1) {
    await BookingModel.updateOne(
      { _id: booking._id },
      { $push: { changeLog: entry, cancelledAttendees: { attendee: removed, cancelledAt: entry.at, cancelledBy: opts.by, reason: opts.reason ?? "" } } },
    ).exec();
    await cancelBooking(bookingId, { reason: opts.reason || `cancelled by ${opts.by}` });
    await voucherRepository.voidAllForBooking(bookingId);
    return (await BookingModel.findById(bookingId).exec())!;
  }

  const remaining = attendees.filter((_, index) => index !== attendeeIndex);
  const updated = await BookingModel.findOneAndUpdate(
    { _id: booking._id, guests: booking.guests },
    {
      $set: { attendees: remaining, guests: booking.guests - 1 },
      $push: { changeLog: entry, cancelledAttendees: { attendee: removed, cancelledAt: entry.at, cancelledBy: opts.by, reason: opts.reason ?? "" } },
    },
    { returnDocument: "after" },
  ).exec();
  if (!updated) throw ActionError.conflict("The registration changed meanwhile. Please try again.");

  const event = await eventRepository.findById(String(booking.eventId));
  if (event?.capacity != null) await eventRepository.releaseCapacity(String(booking.eventId), 1);
  await voucherRepository.removeAttendeeIndex(bookingId, attendeeIndex);
  const schema = (booking.attendeeFieldSchema ?? []).map((f) => plain(f) as AttendeeFieldDef);
  await fieldClaimRepository.releaseValues(bookingId, uniqueClaimsOf(schema, [removed]));
  // Module holdings of just this guest (bus seat, …); also lets a waitlist move up.
  await releaseHooksOnly({ ...plain(booking), _id: booking._id, attendees: [removed] } as unknown as IBooking, "attendee_cancelled");
  return updated;
}

/** A form with module-fed options filled in live (every option, full ones labelled), for organizer forms. */
export async function liveFieldSchemaForEvent(eventId: string, schema: AttendeeFieldDef[]): Promise<AttendeeFieldDef[]> {
  if (!schema.some((field) => field.choicesSource)) return schema;
  const event = await eventRepository.findById(eventId);
  if (!event) return schema;
  const organizationId = event.organizationId ? String(event.organizationId) : null;
  const groupId = event.groupId ? String(event.groupId) : null;
  const modules = await resolveModules({ organizationId, groupId, event });
  const { schema: resolved, details } = await resolveFieldChoices(schema.map((f) => plain(f)), { event, organizationId, groupId, modules });
  return resolved.map((field) =>
    details[field.key]
      ? { ...field, choices: details[field.key]!.map((choice) => ({ value: choice.value, label: choice.disabled ? `${choice.label} (full)` : choice.label })) }
      : field,
  );
}

/**
 * Checks registration answers without registering (e.g. joining a
 * waitlist): the form with module options (full ones allowed), the
 * registration rules, and that no `unique` answer is already registered.
 */
export async function checkRegistrationAnswers(eventId: string, guests: number, attendees: BookingAttendee[]): Promise<BookingAttendee[]> {
  const event = await eventRepository.findById(eventId);
  if (!event) throw ActionError.notFound("Event not found");
  const organizationId = event.organizationId ? String(event.organizationId) : null;
  const groupId = event.groupId ? String(event.groupId) : null;
  const modules = await resolveModules({ organizationId, groupId, event });
  const ctx: EventContext = { event, organizationId, groupId, modules };
  const stored = (event.attendeeFieldSchema ?? []).map((field) => plain(field) as AttendeeFieldDef);
  const { schema, details } = await resolveFieldChoices(stored, ctx);
  const fullSchema = schema.map((field) => (details[field.key] ? { ...field, choices: details[field.key]!.map((c) => ({ value: c.value, label: c.label })) } : field));
  const memberSchema = (event.teamMemberFieldSchema ?? []).map((f) => plain(f) as AttendeeFieldDef);
  const issues = validateAttendees(fullSchema, guests, attendees, memberSchema.length > 0 ? "team" : "person", { teamMemberFieldSchema: memberSchema });
  if (issues.length > 0) throw ActionError.validation(attendeeIssuesMessage(issues, fullSchema), { issues });
  const normalized = normalizeAttendeePayload(fullSchema, attendees, memberSchema);
  const eligibilityEvent = { ...plain(event), eligibilityFormRules: event.eligibilityFormRules as EligibilityRulesConfig | null };
  const eligibilityIssues = validateEligibility(eligibilityEvent, normalized, fullSchema, memberSchema, null, {
    listMembership: await loadDataListMembership(organizationId, collectListLookups(eligibilityEvent, normalized)),
  });
  if (eligibilityIssues.length > 0) throw ActionError.validation(eligibilityIssuesMessage(eligibilityIssues), { issues: eligibilityIssues });
  for (const claim of uniqueClaimsOf(fullSchema, normalized)) {
    if (await fieldClaimRepository.findForEvent(eventId, claim.fieldKey, claim.value)) {
      const label = fullSchema.find((f) => f.key === claim.fieldKey)?.label ?? claim.fieldKey;
      throw ActionError.conflict(`Ezzel a(z) ${label} értékkel már van regisztráció erre az eseményre.`, "duplicate_field");
    }
  }
  return normalized;
}
