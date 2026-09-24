import type { AttendeeFieldDef, AttendeeFieldValue, BookingAttendee } from "@tbook/schemas";

/**
 * Ported from the legacy plugin's lib/registration-fields.ts,
 * lib/registration-headcount.ts, and lib/attendee-fields.ts (validation +
 * payload-shaping parts only — key-assignment helpers are an admin-form-save
 * concern, already deferred out of @tbook/domain's hotel-pricing.ts port for
 * the same reason, so they're skipped here too).
 *
 * Deliberate change vs. legacy: validation issues carry a structured
 * `reason` instead of a pre-translated `tbookT(locale, ...)` string, mirror
 * ing @tbook/domain/eligibility.ts's EligibilityIssue design — this package
 * still isn't the place for presentation copy. NOTE: these are genuinely
 * pure functions (no I/O); a follow-up cleanup could move this whole file
 * into @tbook/domain alongside eligibility.ts — kept in @tbook/services for
 * this pass since that package was out of scope for this fork.
 */

export type RegistrationUnit = "person" | "team";
export type RegistrationFieldsMode = "extend" | "replace";

function normalizeAttendeeFieldSchema(fields: AttendeeFieldDef[] | undefined | null): AttendeeFieldDef[] {
  if (!fields?.length) return [];
  return fields.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

/** Merge event + hotel registration field schemas (later schemas' keys win on collision). */
export function mergeRegistrationFieldSchemas(...schemas: Array<AttendeeFieldDef[] | undefined | null>): AttendeeFieldDef[] {
  const merged: AttendeeFieldDef[] = [];
  const keys = new Set<string>();
  for (const schema of schemas) {
    for (const field of normalizeAttendeeFieldSchema(schema)) {
      if (keys.has(field.key)) continue;
      keys.add(field.key);
      merged.push(field);
    }
  }
  return merged;
}

/**
 * Resolve event registration fields from group defaults + event overrides.
 * extend: group base + event fields (same key on event replaces the group field).
 * replace: only event fields (group defaults ignored).
 */
export function resolveEventAttendeeFieldSchema(
  groupSchema: AttendeeFieldDef[] | undefined | null,
  eventSchema: AttendeeFieldDef[] | undefined | null,
  mode: RegistrationFieldsMode = "extend",
): AttendeeFieldDef[] {
  const eventFields = normalizeAttendeeFieldSchema(eventSchema);
  if (mode === "replace") return eventFields;

  const groupFields = normalizeAttendeeFieldSchema(groupSchema);
  const byKey = new Map<string, AttendeeFieldDef>();
  for (const field of groupFields) byKey.set(field.key, field);
  for (const field of eventFields) byKey.set(field.key, field);

  const ordered: AttendeeFieldDef[] = [];
  const seen = new Set<string>();
  for (const field of groupFields) {
    const resolved = byKey.get(field.key);
    if (!resolved || seen.has(field.key)) continue;
    ordered.push(resolved);
    seen.add(field.key);
  }
  for (const field of eventFields) {
    if (seen.has(field.key)) continue;
    ordered.push(field);
    seen.add(field.key);
  }
  return ordered;
}

export function resolveTeamMemberFieldSchema(opts: {
  registrationUnit?: RegistrationUnit;
  groupSchema?: AttendeeFieldDef[] | null;
  eventTeamMemberSchema?: AttendeeFieldDef[] | null;
  eventTicketSchema?: AttendeeFieldDef[] | null;
  mode?: RegistrationFieldsMode;
}): AttendeeFieldDef[] {
  const unit = opts.registrationUnit ?? "person";
  const explicit = normalizeAttendeeFieldSchema(opts.eventTeamMemberSchema);
  if (explicit.length > 0) {
    return unit === "team" ? resolveEventAttendeeFieldSchema(opts.groupSchema, explicit, opts.mode ?? "extend") : explicit;
  }
  if (unit === "team") return resolveEventAttendeeFieldSchema(opts.groupSchema, opts.eventTicketSchema, opts.mode ?? "extend");
  return [];
}

/** Ticket-level fields shown once per entry. Empty for team events (member form only). */
export function resolveTicketAttendeeFieldSchema(opts: {
  registrationUnit?: RegistrationUnit;
  groupSchema?: AttendeeFieldDef[] | null;
  eventSchema?: AttendeeFieldDef[] | null;
  mode?: RegistrationFieldsMode;
}): AttendeeFieldDef[] {
  if ((opts.registrationUnit ?? "person") === "team") return [];
  return resolveEventAttendeeFieldSchema(opts.groupSchema, opts.eventSchema, opts.mode ?? "extend");
}

// ---- Headcount -------------------------------------------------------------

export interface HeadcountEventLike {
  registrationUnit?: RegistrationUnit;
  playersPerTicket?: number | null;
  teamMemberLimit?: number | null;
  teamMemberFieldSchema?: AttendeeFieldDef[];
}

/**
 * Fixed players per ticket/entry. Explicit playersPerTicket > 1 → fixed
 * roster (e.g. pair = 2). Does NOT use teamMemberLimit (that's a flexible
 * max for team events).
 */
export function resolvePlayersPerTicket(event: HeadcountEventLike): number {
  const explicit = event.playersPerTicket;
  if (explicit != null && Number.isFinite(explicit) && explicit >= 1) return Math.max(1, Math.min(100, Math.floor(explicit)));
  return 1;
}

export function usesFixedPlayerRoster(event: HeadcountEventLike): boolean {
  return resolvePlayersPerTicket(event) > 1;
}

export function needsPlayerMemberForms(event: HeadcountEventLike): boolean {
  if (usesFixedPlayerRoster(event)) return (event.teamMemberFieldSchema?.length ?? 0) > 0;
  return (event.registrationUnit ?? "person") === "team" && (event.teamMemberFieldSchema?.length ?? 0) > 0;
}

/** Maximum hotel/package headcount allowed for this booking. */
export function accommodationGuestCount(ticketCount: number, event: HeadcountEventLike): number {
  const tickets = Math.max(1, Math.floor(ticketCount || 1));
  if (usesFixedPlayerRoster(event)) return tickets * resolvePlayersPerTicket(event);
  if ((event.registrationUnit ?? "person") === "team" && event.teamMemberLimit != null) {
    const limit = Math.max(1, Math.min(100, Math.floor(event.teamMemberLimit)));
    return tickets * limit;
  }
  return tickets;
}

export interface RosterAttendeeLike {
  members?: unknown[] | null;
}

/** Actual (or currently planned) player count. Missing roster falls back to one player per entry. */
export function countRosterPlayers(attendees: RosterAttendeeLike[] | null | undefined, event: HeadcountEventLike, ticketCount: number): number {
  const tickets = Math.max(1, Math.floor(ticketCount || 1));
  const max = accommodationGuestCount(tickets, event);
  if (usesFixedPlayerRoster(event)) return Math.min(tickets * resolvePlayersPerTicket(event), max);
  if ((event.registrationUnit ?? "person") !== "team") return Math.min(tickets, max);

  const rows = attendees ?? [];
  if (rows.length === 0) return Math.min(tickets, max);

  let total = 0;
  for (const row of rows) total += Math.max(1, Array.isArray(row.members) ? row.members.length : 0);
  return Math.min(Math.max(1, total), max);
}

// ---- Attendee validation ----------------------------------------------------

export type AttendeeIssueReason =
  | "count_mismatch"
  | "field_required"
  | "field_invalid"
  | "roster_size_mismatch"
  | "roster_empty"
  | "roster_too_large";

export interface AttendeeValidationIssue {
  index: number;
  fieldKey: string;
  memberIndex?: number;
  reason: AttendeeIssueReason;
  details?: Record<string, unknown>;
}

function validateFieldValue(field: AttendeeFieldDef, raw: AttendeeFieldValue | undefined): AttendeeIssueReason | null {
  if (raw == null || raw === "") return field.required ? "field_required" : null;

  switch (field.type) {
    case "text":
      return typeof raw === "string" && raw.trim() ? null : "field_invalid";
    case "email":
      return typeof raw === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim()) ? null : "field_invalid";
    case "phone":
      return typeof raw === "string" && raw.trim().length >= 6 ? null : "field_invalid";
    case "number": {
      const num = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(num)) return "field_invalid";
      if (field.min != null && num < field.min) return "field_invalid";
      if (field.max != null && num > field.max) return "field_invalid";
      return null;
    }
    case "date":
      return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? null : "field_invalid";
    case "select": {
      const allowed = field.choices?.map((c) => c.value) ?? [];
      return allowed.includes(String(raw)) ? null : "field_invalid";
    }
    default:
      return null;
  }
}

export function validateAttendees(
  schema: AttendeeFieldDef[],
  guests: number,
  attendees: BookingAttendee[] | undefined | null,
  registrationUnit: RegistrationUnit = "person",
  teamOpts?: { teamMemberFieldSchema?: AttendeeFieldDef[]; teamMemberLimit?: number | null; playersPerTicket?: number | null },
): AttendeeValidationIssue[] {
  const normalized = normalizeAttendeeFieldSchema(schema);
  const memberSchema = normalizeAttendeeFieldSchema(teamOpts?.teamMemberFieldSchema);
  const memberLimit = teamOpts?.teamMemberLimit ?? null;
  const fixedRoster = teamOpts?.playersPerTicket != null && teamOpts.playersPerTicket > 1 ? teamOpts.playersPerTicket : null;

  if (normalized.length === 0 && memberSchema.length === 0) return [];

  const issues: AttendeeValidationIssue[] = [];
  const rows = attendees ?? [];

  if (rows.length !== guests) {
    return [{ index: -1, fieldKey: "", reason: "count_mismatch", details: { expected: guests, actual: rows.length } }];
  }

  const needsMembers = memberSchema.length > 0 && (fixedRoster != null || registrationUnit === "team");

  rows.forEach((attendee, index) => {
    for (const field of normalized) {
      const reason = validateFieldValue(field, attendee.fields?.[field.key]);
      if (reason) issues.push({ index, fieldKey: field.key, reason });
    }

    if (!needsMembers) return;

    const members = attendee.members ?? [];

    if (fixedRoster != null && members.length !== fixedRoster) {
      issues.push({ index, fieldKey: "", reason: "roster_size_mismatch", details: { required: fixedRoster, actual: members.length } });
      return;
    }
    if (members.length === 0) {
      issues.push({ index, fieldKey: "", reason: "roster_empty" });
      return;
    }
    if (memberLimit != null && fixedRoster == null && members.length > memberLimit) {
      issues.push({ index, fieldKey: "", reason: "roster_too_large", details: { limit: memberLimit, actual: members.length } });
    }

    members.forEach((member, memberIndex) => {
      for (const field of memberSchema) {
        const reason = validateFieldValue(field, member.fields?.[field.key]);
        if (reason) issues.push({ index, fieldKey: field.key, memberIndex, reason });
      }
    });
  });

  return issues;
}

export function normalizeAttendeePayload(schema: AttendeeFieldDef[], attendees: BookingAttendee[] | undefined | null, teamMemberSchema: AttendeeFieldDef[] = []): BookingAttendee[] {
  const normalized = normalizeAttendeeFieldSchema(schema);
  const normalizedMembers = normalizeAttendeeFieldSchema(teamMemberSchema);
  if (normalized.length === 0 && normalizedMembers.length === 0) return [];

  const normalizeFields = (fieldDefs: AttendeeFieldDef[], rawFields: Record<string, AttendeeFieldValue> | undefined) => {
    const fields: Record<string, AttendeeFieldValue> = {};
    for (const field of fieldDefs) {
      const raw = rawFields?.[field.key];
      if (raw == null || raw === "") continue;
      fields[field.key] = field.type === "number" ? (typeof raw === "number" ? raw : Number(raw)) : String(raw).trim();
    }
    return fields;
  };

  return (attendees ?? []).map((attendee) => {
    const fields = normalizeFields(normalized, attendee.fields);
    if (normalizedMembers.length === 0) return { fields };
    const members = (attendee.members ?? []).map((member) => ({ fields: normalizeFields(normalizedMembers, member.fields) }));
    return { fields, members };
  });
}

// ---- Sales window ------------------------------------------------------------

export type EventSalesState = "on_sale" | "upcoming" | "closed";

export function getEventSalesState(event: { salesOpensAt?: Date | null; salesClosesAt?: Date | null }, now = new Date()): EventSalesState {
  const opens = event.salesOpensAt ? new Date(event.salesOpensAt) : null;
  const closes = event.salesClosesAt ? new Date(event.salesClosesAt) : null;
  if (opens && !Number.isNaN(opens.getTime()) && now < opens) return "upcoming";
  if (closes && !Number.isNaN(closes.getTime()) && now > closes) return "closed";
  return "on_sale";
}
