import { Types } from "mongoose";
import { ActionError } from "@tbook/actions";
import {
  bookingRepository,
  eventGroupRepository,
  eventRepository,
  hotelRepository,
  type IEvent,
  type IEventGroup,
  type IHotel,
} from "@tbook/db";
import { dayAvailability } from "@tbook/domain";
import type { AdminEventGroupInput, AdminEventInput, AdminHotelInput } from "@tbook/schemas";
import { apiKeyHint, generateApiKey, hashApiKey } from "./api-key";
import { assertEventInOrg } from "./voucher-admin-service";

/**
 * Catalog management: event groups, events and hotels.
 *
 * Until this existed the only way data got into these collections was the
 * legacy migration. Ownership follows the booking scope's two-way rule — a
 * record belongs to an org if it carries the organizationId or hangs off
 * one of the org's groups — and every lookup reports 404 rather than 403 so
 * another org's ids can't be probed. Permission checks stay at the request
 * layer.
 */

async function orgGroupIds(organizationId: string): Promise<string[]> {
  const groups = await eventGroupRepository.findByOrganizationId(organizationId);
  return groups.map((group) => String(group._id));
}

/* ---- Event groups ---------------------------------------------------- */

export async function listGroupsForOrg(organizationId: string): Promise<IEventGroup[]> {
  const groups = await eventGroupRepository.findByOrganizationId(organizationId);
  return groups.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getGroupForOrg(organizationId: string, groupId: string): Promise<IEventGroup> {
  const group = Types.ObjectId.isValid(groupId) ? await eventGroupRepository.findById(groupId) : null;
  if (!group || String(group.organizationId) !== organizationId) throw ActionError.notFound("Event group not found");
  return group;
}

/** Creates a group and returns its API key in plaintext — the only time it is ever readable. */
export async function createEventGroup(
  organizationId: string,
  input: AdminEventGroupInput,
): Promise<{ group: IEventGroup; apiKey: string }> {
  const apiKey = generateApiKey();
  const group = await eventGroupRepository.create({
    ...input,
    organizationId: new Types.ObjectId(organizationId),
    apiKeyHash: hashApiKey(apiKey),
    apiKeyHint: apiKeyHint(apiKey),
    apiKeyCreatedAt: new Date(),
  });
  return { group, apiKey };
}

export async function updateEventGroup(
  organizationId: string,
  groupId: string,
  input: AdminEventGroupInput,
): Promise<IEventGroup> {
  await getGroupForOrg(organizationId, groupId);
  const updated = await eventGroupRepository.updateById(groupId, input);
  if (!updated) throw ActionError.notFound("Event group not found");
  return updated;
}

/** Replaces the group's API key. The old key stops working immediately. */
export async function rotateEventGroupApiKey(organizationId: string, groupId: string): Promise<{ apiKey: string }> {
  await getGroupForOrg(organizationId, groupId);
  const apiKey = generateApiKey();
  await eventGroupRepository.updateById(groupId, {
    apiKeyHash: hashApiKey(apiKey),
    apiKeyHint: apiKeyHint(apiKey),
    apiKeyCreatedAt: new Date(),
  });
  return { apiKey };
}

/* ---- Events ---------------------------------------------------------- */

export async function listEventsForOrg(organizationId: string): Promise<IEvent[]> {
  return eventRepository.findForOrgScope(organizationId, await orgGroupIds(organizationId));
}

export async function getEventForOrg(organizationId: string, eventId: string): Promise<IEvent> {
  if (!Types.ObjectId.isValid(eventId)) throw ActionError.notFound("Event not found");
  return assertEventInOrg(organizationId, eventId);
}

function eventDocumentFromInput(input: AdminEventInput) {
  const { address, tdartsEnabled, tdartsTournamentCode, groupId, dayPass, ...rest } = input;
  return {
    ...rest,
    // A standard event carries no pass config, so switching kinds can't leave stale pricing behind.
    dayPass: input.kind === "day_pass" ? dayPass : null,
    groupId: new Types.ObjectId(groupId),
    "location.address": address,
    tdarts: { enabled: tdartsEnabled, tournamentCode: tdartsEnabled ? tdartsTournamentCode : null },
  };
}

export async function createEvent(organizationId: string, input: AdminEventInput): Promise<IEvent> {
  await getGroupForOrg(organizationId, input.groupId);
  const { "location.address": address, ...doc } = eventDocumentFromInput(input);
  return eventRepository.create({
    ...doc,
    organizationId: new Types.ObjectId(organizationId),
    location: { address, lat: null, lng: null, mapEmbedUrl: "" },
  });
}

export async function updateEvent(organizationId: string, eventId: string, input: AdminEventInput): Promise<IEvent> {
  const existing = await getEventForOrg(organizationId, eventId);
  await getGroupForOrg(organizationId, input.groupId);

  // Shrinking capacity below what is already sold would leave the counter
  // pointing at an impossible state and silently block every later sale.
  if (input.capacity !== null && input.capacity < existing.soldGuestCount) {
    throw ActionError.validation(`Capacity can't be lower than the ${existing.soldGuestCount} entries already sold.`);
  }

  await assertDayPassEditAllowed(existing, input);

  const { "location.address": address, ...doc } = eventDocumentFromInput(input);
  const updated = await eventRepository.updateById(eventId, {
    ...doc,
    location: { ...(existing.location ?? { lat: null, lng: null, mapEmbedUrl: "" }), address },
  });
  if (!updated) throw ActionError.notFound("Event not found");
  return updated;
}

/**
 * Guards the edits that would silently corrupt day-pass sales that already
 * exist: switching an event between kinds once anything is sold, dropping a
 * day that has passes sold from the date range, or capping a day below what
 * it has already sold.
 */
async function assertDayPassEditAllowed(existing: IEvent, input: AdminEventInput): Promise<void> {
  const existingKind = existing.kind ?? "standard";
  const daySold = (existing.daySold ?? {}) as Record<string, number>;

  if (existingKind !== input.kind) {
    const sold = await bookingRepository.aggregateGuestCountForEvent(String(existing._id), ["pending", "checkout_started", "paid", "confirmed"]);
    if (sold > 0) throw ActionError.validation("This event already has bookings, so its type can't be changed.");
    return;
  }
  if (input.kind !== "day_pass" || !input.dayPass) return;

  const rows = dayAvailability({ config: input.dayPass, startDate: input.startDate, endDate: input.endDate, daySold });
  const inRange = new Set(rows.map((row) => row.date));
  for (const [date, count] of Object.entries(daySold)) {
    if (count > 0 && !inRange.has(date)) {
      throw ActionError.validation(`${date} has ${count} pass(es) sold, so it must stay inside the event dates.`);
    }
  }
  for (const row of rows) {
    if (row.capacity !== null && row.sold > row.capacity) {
      throw ActionError.validation(`${row.date} has ${row.sold} passes sold — its capacity can't be lower than that.`);
    }
  }
}

/** Per-day availability for the admin event page. */
export function describeDayPassAvailability(event: IEvent) {
  if (event.kind !== "day_pass" || !event.dayPass) return [];
  return dayAvailability({
    config: event.dayPass,
    startDate: event.startDate,
    endDate: event.endDate,
    daySold: event.daySold as Record<string, number> | undefined,
  });
}

/* ---- Hotels ---------------------------------------------------------- */

export async function listHotelsForOrg(organizationId: string): Promise<IHotel[]> {
  return hotelRepository.findForOrgScope(organizationId, await orgGroupIds(organizationId));
}

export async function getHotelForOrg(organizationId: string, hotelId: string): Promise<IHotel> {
  const hotel = Types.ObjectId.isValid(hotelId) ? await hotelRepository.findById(hotelId) : null;
  if (!hotel) throw ActionError.notFound("Hotel not found");

  if (hotel.organizationId && String(hotel.organizationId) === organizationId) return hotel;
  if (hotel.groupId) {
    const group = await eventGroupRepository.findById(String(hotel.groupId));
    if (group?.organizationId && String(group.organizationId) === organizationId) return hotel;
  }
  throw ActionError.notFound("Hotel not found");
}

function hotelDocumentFromInput(input: AdminHotelInput) {
  const { priceBasis, vatPercent, roomTypes, packages, groupId, ...rest } = input;
  return { ...rest, groupId: new Types.ObjectId(groupId), priceBasis, vatPercent, roomTypes, packages };
}

export async function createHotel(organizationId: string, input: AdminHotelInput): Promise<IHotel> {
  await getGroupForOrg(organizationId, input.groupId);
  const { priceBasis, vatPercent, roomTypes, packages, ...doc } = hotelDocumentFromInput(input);
  return hotelRepository.create({
    ...doc,
    organizationId: new Types.ObjectId(organizationId),
    pricing: {
      priceBasis,
      vatPercent,
      accommodationMode: accommodationModeFor(roomTypes.length, packages.length),
      roomTypes,
      packages,
      extrasSection: null,
      addonGroups: [],
    },
  });
}

export async function updateHotel(organizationId: string, hotelId: string, input: AdminHotelInput): Promise<IHotel> {
  const existing = await getHotelForOrg(organizationId, hotelId);
  await getGroupForOrg(organizationId, input.groupId);

  const { priceBasis, vatPercent, roomTypes, packages, ...doc } = hotelDocumentFromInput(input);
  const updated = await hotelRepository.updateById(hotelId, {
    ...doc,
    // Spread the existing pricing so extras sections and legacy fields the
    // console doesn't edit survive the save.
    pricing: {
      ...(existing.pricing as object),
      priceBasis,
      vatPercent,
      accommodationMode: accommodationModeFor(roomTypes.length, packages.length),
      roomTypes,
      packages,
    } as IHotel["pricing"],
  });
  if (!updated) throw ActionError.notFound("Hotel not found");
  return updated;
}

function accommodationModeFor(roomTypeCount: number, packageCount: number): "room_nights" | "packages" | "both" {
  if (roomTypeCount > 0 && packageCount > 0) return "both";
  return packageCount > 0 ? "packages" : "room_nights";
}
