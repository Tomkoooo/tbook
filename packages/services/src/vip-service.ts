import { BookingModel, DataListRowModel, FieldClaimModel, eventRepository, fieldClaimRepository } from "@tbook/db";
import { normalizeUniqueValue } from "@tbook/domain";
import type { AttendeeFieldDef, AttendeeFieldValue } from "@tbook/schemas";
import { getDataListForOrg, findDataListRow } from "./data-list-service";

/**
 * VIP guests: a data list of names (key normalisation "name") set on the event
 * as `vipListId`. A VIP registers with their name in the event's identifying
 * question (the one DSO employees answer with their employee ID), written the
 * way the list has it. VIPs skip the registration rules, take a seat from the
 * event's separate VIP pool (`vipCapacity`) and are tagged "VIP" so the door
 * sees it on the scan.
 */
export const VIP_TAG = "VIP";

interface VipEventLike {
  vipListId?: unknown;
  organizationId?: unknown;
}

export function vipListIdOf(event: VipEventLike): string | null {
  return event.vipListId ? String(event.vipListId) : null;
}

/** The question VIPs (and employees) identify themselves with. */
export function identifierKeyOf(schema: Array<Pick<AttendeeFieldDef, "key" | "identifier" | "unique">>): string | null {
  return schema.find((field) => field.identifier)?.key ?? schema.find((field) => field.unique)?.key ?? null;
}

/** The list's own spelling of a VIP's name ("dr. Kiss Csaba"), or null when the name isn't on the VIP list. */
export async function findVipName(event: VipEventLike, rawName: string): Promise<string | null> {
  const listId = vipListIdOf(event);
  const organizationId = event.organizationId ? String(event.organizationId) : null;
  if (!listId || !organizationId || !rawName.trim()) return null;
  const row = await findDataListRow(organizationId, listId, rawName).catch(() => null);
  if (!row) return null;
  const list = await getDataListForOrg(organizationId, listId);
  const name = row[list.nameColumn ?? list.keyColumn] ?? row[list.keyColumn];
  return name ? String(name) : null;
}

/** Which of these attendees are on the event's VIP list (matched by their identifying answer). */
export async function vipAttendeeFlags(
  event: VipEventLike,
  schema: Array<Pick<AttendeeFieldDef, "key" | "identifier" | "unique">>,
  attendees: Array<{ fields?: Record<string, AttendeeFieldValue> } | undefined>,
): Promise<boolean[]> {
  const key = identifierKeyOf(schema);
  if (!vipListIdOf(event) || !key) return attendees.map(() => false);
  return Promise.all(attendees.map(async (attendee) => Boolean(await findVipName(event, String(attendee?.fields?.[key] ?? "")))));
}

export interface VipLookupResult {
  found: boolean;
  alreadyRegistered: boolean;
  /** The list's spelling: send it back as the identifying answer. */
  name: string | null;
}

export async function lookupVip(eventId: string, rawName: string, opts: { isTest?: boolean } = {}): Promise<VipLookupResult> {
  const event = await eventRepository.findById(eventId);
  if (!event) return { found: false, alreadyRegistered: false, name: null };
  const name = await findVipName(event, rawName);
  if (!name) return { found: false, alreadyRegistered: false, name: null };
  const key = identifierKeyOf((event.attendeeFieldSchema ?? []) as AttendeeFieldDef[]);
  const claimed = key ? await fieldClaimRepository.findForEvent(eventId, key, normalizeUniqueValue(name), opts.isTest) : null;
  return { found: true, alreadyRegistered: Boolean(claimed), name };
}

/** The attendees the registration rules apply to: everyone except VIPs. */
export async function attendeesSubjectToRules<T extends { fields?: Record<string, AttendeeFieldValue> }>(
  event: VipEventLike,
  schema: Array<Pick<AttendeeFieldDef, "key" | "identifier" | "unique">>,
  attendees: T[],
): Promise<T[]> {
  if (!vipListIdOf(event)) return attendees;
  const flags = await vipAttendeeFlags(event, schema, attendees);
  return attendees.filter((_, index) => !flags[index]);
}

export interface VipRosterRow {
  name: string;
  registered: boolean;
  registrationNumber: string | null;
  registeredAt: Date | null;
  bookingId: string | null;
  /** The booking's contact, so organizers can follow up with VIPs who haven't registered. */
  email: string | null;
}

/** The VIP list with who has registered (live registrations only), for the organizers' VIP page. */
export async function vipRoster(eventId: string): Promise<{ rows: VipRosterRow[]; registered: number; total: number } | null> {
  const event = await eventRepository.findById(eventId);
  const listId = event ? vipListIdOf(event) : null;
  if (!event || !listId) return null;
  const list = await getDataListForOrg(String(event.organizationId), listId);
  const key = identifierKeyOf((event.attendeeFieldSchema ?? []) as AttendeeFieldDef[]);
  const listRows = await DataListRowModel.find({ listId }).lean().exec();
  const claims = key ? await FieldClaimModel.find({ eventId, fieldKey: key }).lean().exec() : [];
  const byValue = new Map(claims.map((claim) => [claim.value, claim]));
  const bookings = await BookingModel.find({ _id: { $in: claims.map((claim) => claim.bookingId) } }, { registrationNumber: 1, createdAt: 1, customer: 1, attendees: 1 }).lean().exec();
  const bookingById = new Map(bookings.map((booking) => [String(booking._id), booking]));
  const rows = listRows
    .map((row) => {
      const data = row.data as Record<string, string>;
      const name = String(data[list.nameColumn ?? list.keyColumn] ?? row.key);
      const claim = byValue.get(normalizeUniqueValue(name));
      const booking = claim ? bookingById.get(String(claim.bookingId)) : undefined;
      const attendee = booking?.attendees?.find((a) => normalizeUniqueValue(a.fields?.[key ?? ""] as string) === normalizeUniqueValue(name));
      return {
        name,
        registered: Boolean(claim),
        registrationNumber: attendee?.registrationNumber ?? booking?.registrationNumber ?? null,
        registeredAt: claim?.createdAt ?? null,
        bookingId: claim ? String(claim.bookingId) : null,
        email: booking?.customer?.email ?? null,
      } satisfies VipRosterRow;
    })
    .sort((a, b) => Number(b.registered) - Number(a.registered) || a.name.localeCompare(b.name, "hu"));
  return { rows, registered: rows.filter((row) => row.registered).length, total: rows.length };
}
