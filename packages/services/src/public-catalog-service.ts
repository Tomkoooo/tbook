import {
  BookingModel,
  eventGroupRepository,
  eventNights,
  eventRepository,
  hotelRepository,
  organizationRepository,
  type IEvent,
  type IEventGroup,
  type IHotel,
} from "@tbook/db";
import {
  dayAvailability,
  filterAvailablePackages,
  isHotelPubliclyAvailable,
  normalizeHotelPricing,
  packageUnitsFromSelections,
  remainingHotelBookingCapacity,
  remainingHotelRoomInventory,
  resolveAccommodationMode,
  toGrossAmount,
  todayDayKey,
  totalPackageUnits,
  withPackageRemainingUnits,
} from "@tbook/domain";
import { bookingRepository } from "@tbook/db";
import { WALK_IN_CUSTOMER_EMAIL } from "@tbook/schemas";
import { resolveTeamMemberFieldSchema, resolveTicketAttendeeFieldSchema } from "./booking-validation";
import { normalizeTBookCurrency } from "./currency";

/**
 * Public (unauthenticated or API-key-scoped) read models for the storefront
 * — ported from the legacy plugin's services/event-service.ts's public
 * methods (listPublicDirectory / listPublicEventsForGroup /
 * getPublicEventDetail) plus the small helper functions it composed
 * (lib/event-public-listing.ts, lib/event-hero.ts, lib/public-eligibility.ts,
 * lib/tdarts-client.ts's resolveTDartsEmbedConfig — folded in here as
 * private functions rather than many tiny files).
 *
 * getPublicEntryList (read-only team roster display) is deliberately NOT
 * ported this pass — lower priority than the core quote/booking flow.
 */

// ---- Small ported helpers ---------------------------------------------------

/** legacy: lib/event-public-listing.ts */
function isEventListedOnPublicSite(publicListing: string | null | undefined): boolean {
  return publicListing !== "link_only";
}

/** legacy: lib/event-hero.ts — event upload wins; otherwise group default. */
function resolveEventHeroImage(event: { heroImage?: string | null }, group?: { defaultHeroImage?: string | null } | null): string {
  const eventHero = event.heroImage?.trim();
  if (eventHero) return eventHero;
  return group?.defaultHeroImage?.trim() || "";
}

/** legacy: lib/public-eligibility.ts — safe-to-expose subset of eligibility config. */
function publicEligibilityFromEvent(event: IEvent) {
  const genders = event.eligibilityAllowedGenders;
  return {
    eligibilityPreset: event.eligibilityPreset ?? "none",
    eligibilityMinAge: event.eligibilityMinAge ?? null,
    eligibilityMaxAge: event.eligibilityMaxAge ?? null,
    eligibilityAllowedGenders: genders && genders.length > 0 ? genders.map((g) => String(g)) : null,
    eligibilityBirthDateFieldKey: event.eligibilityBirthDateFieldKey?.trim() || null,
    eligibilityGenderFieldKey: event.eligibilityGenderFieldKey?.trim() || null,
    eligibilityFormRules: event.eligibilityFormRules ?? null,
  };
}

interface TDartsEmbedConfig {
  apiBaseUrl: string;
  embedClientId: string;
}

/** legacy: lib/tdarts-client.ts's resolveTDartsEmbedConfig — browser-safe subset, NEVER the partner secret. */
function resolveTDartsEmbedConfig(org: { settings?: { tdarts?: { enabled?: boolean; apiBaseUrl?: string; embedClientId?: string } } } | null): TDartsEmbedConfig | null {
  const t = org?.settings?.tdarts;
  if (!t?.enabled) return null;
  const apiBaseUrl = t.apiBaseUrl?.trim().replace(/\/+$/, "");
  const embedClientId = t.embedClientId?.trim();
  if (!apiBaseUrl || !embedClientId) return null;
  return { apiBaseUrl, embedClientId };
}

function publicTDartsInfo(event: Pick<IEvent, "tdarts">, embed: TDartsEmbedConfig | null) {
  if (!embed || !event.tdarts?.enabled || !event.tdarts.tournamentCode) return null;
  return { tournamentCode: event.tdarts.tournamentCode, apiBaseUrl: embed.apiBaseUrl, embedClientId: embed.embedClientId };
}

function publicEventFieldSchemas(event: IEvent, group?: Pick<IEventGroup, "defaultAttendeeFieldSchema"> | null) {
  const registrationUnit = event.registrationUnit ?? "person";
  const mode = event.attendeeFieldSchemaMode ?? "extend";
  return {
    attendeeFieldSchema: resolveTicketAttendeeFieldSchema({
      registrationUnit,
      groupSchema: group?.defaultAttendeeFieldSchema,
      eventSchema: event.attendeeFieldSchema,
      mode,
    }),
    teamMemberFieldSchema: resolveTeamMemberFieldSchema({
      registrationUnit,
      groupSchema: group?.defaultAttendeeFieldSchema,
      eventTeamMemberSchema: event.teamMemberFieldSchema,
      eventTicketSchema: event.attendeeFieldSchema,
      mode,
    }),
  };
}

/**
 * Day-pass storefront data: one row per day with the price the buyer will
 * actually pay and whether that day can be bought right now. Sold counts are
 * deliberately not exposed — only what is left.
 */
function publicDayPass(event: IEvent) {
  if (event.kind !== "day_pass" || !event.dayPass) return null;
  const config = event.dayPass;
  const today = todayDayKey(new Date());
  const days = dayAvailability({
    config,
    startDate: event.startDate,
    endDate: event.endDate,
    daySold: event.daySold as Record<string, number> | undefined,
  }).map((day) => {
    const unitPriceGrossHuf = Math.round(toGrossAmount(day.priceHuf, event.ticketPriceBasis ?? "net", event.ticketVatPercent ?? 27));
    return {
      date: day.date,
      weekend: day.weekend,
      unitPriceGrossHuf,
      remaining: day.remaining,
      closed: day.closed,
      bookable: !day.closed && day.date >= today && (day.remaining === null || day.remaining > 0),
    };
  });
  return {
    weekendDays: config.weekendDays,
    weekdaySchedule: config.weekdaySchedule,
    weekendSchedule: config.weekendSchedule,
    days,
  };
}

function serializePublicEvent(event: IEvent, group: IEventGroup | null, embedConfig: TDartsEmbedConfig | null) {
  const fields = publicEventFieldSchemas(event, group);
  return {
    id: String(event._id),
    name: event.name,
    description: event.description,
    location: {
      address: event.location?.address ?? "",
      lat: event.location?.lat ?? null,
      lng: event.location?.lng ?? null,
      mapEmbedUrl: event.location?.mapEmbedUrl ?? "",
    },
    startDate: event.startDate,
    endDate: event.endDate,
    startTime: event.startTime ?? null,
    endTime: event.endTime ?? null,
    salesOpensAt: event.salesOpensAt ?? null,
    salesClosesAt: event.salesClosesAt ?? null,
    nights: eventNights(event),
    kind: event.kind ?? "standard",
    dayPass: publicDayPass(event),
    ticketFeeHuf: event.ticketFeeHuf,
    ticketFeeMode: event.ticketFeeMode,
    registrationUnit: event.registrationUnit ?? "person",
    playersPerTicket: event.playersPerTicket ?? 1,
    teamMemberLimit: event.teamMemberLimit ?? null,
    teamMemberFieldSchema: fields.teamMemberFieldSchema,
    attendeeFieldSchema: fields.attendeeFieldSchema,
    currency: normalizeTBookCurrency(event.currency),
    heroImage: resolveEventHeroImage(event, group),
    tdarts: publicTDartsInfo(event, embedConfig),
    publicEntryList: Boolean(event.publicEntryList),
    ...publicEligibilityFromEvent(event),
  };
}

// ---- Public directory (no API key) -----------------------------------------

export interface PublicDirectoryListing {
  id: string;
  title: string;
  url: string;
  image: string;
  activeEventCount: number;
  nextEventStart: Date | null;
}

export async function listPublicDirectory(): Promise<PublicDirectoryListing[]> {
  const now = new Date();
  const groups = await eventGroupRepository.findPublicListed();

  const listings = await Promise.all(
    groups.map(async (group) => {
      const groupId = String(group._id);
      const [activeEventCount, nextEvent] = await Promise.all([
        eventRepository.countActiveUpcomingForGroup(groupId, now),
        eventRepository.findNextActiveUpcomingForGroup(groupId, now),
      ]);
      return {
        id: groupId,
        title: group.listingTitle?.trim() || group.name,
        url: group.listingUrl ?? "",
        image: group.listingImage ?? "",
        activeEventCount,
        nextEventStart: nextEvent?.startDate ?? null,
      };
    }),
  );

  return listings.filter((listing) => listing.activeEventCount > 0);
}

// ---- Public, API-key scoped reads ------------------------------------------

export async function listPublicEventsForGroup(groupId: string): Promise<ReturnType<typeof serializePublicEvent>[]> {
  const group = await eventGroupRepository.findById(groupId);
  const org = group?.organizationId ? await organizationRepository.findById(String(group.organizationId)) : null;
  const embedConfig = resolveTDartsEmbedConfig(org);
  const events = await eventRepository.findActiveByGroupId(groupId);
  return events.filter((e) => isEventListedOnPublicSite(e.publicListing)).map((e) => serializePublicEvent(e, group, embedConfig));
}

export interface PublicHotelListing {
  id: string;
  name: string;
  description: string;
  address: string;
  distanceFromVenueKm: number | null;
  gallery: string[];
  currency: string;
  bookingCapacity: number | null;
  remainingCapacity: number | null;
  roomInventory: number | null;
  remainingRoomInventory: number | null;
  registrationFieldSchema: IHotel["registrationFieldSchema"];
  pricing: IHotel["pricing"];
}

async function serializePublicHotel(hotel: IHotel): Promise<PublicHotelListing | null> {
  const pricing = normalizeHotelPricing(hotel.pricing);
  const packages = pricing.packages ?? [];
  const mode = resolveAccommodationMode(pricing);
  const bookingCapacity = typeof hotel.bookingCapacity === "number" && hotel.bookingCapacity >= 0 ? hotel.bookingCapacity : null;
  const roomInventory = typeof hotel.roomInventory === "number" && hotel.roomInventory >= 0 ? hotel.roomInventory : null;

  const activeStatuses = ["pending", "checkout_started", "paid", "confirmed"] as const;
  const summaries = await bookingRepository.findAccommodationSummariesByHotel(String(hotel._id), [...activeStatuses]);
  const soldGuests = bookingCapacity != null ? summaries.reduce((sum, s) => sum + s.accommodationGuests, 0) : 0;
  const remainingCapacity = remainingHotelBookingCapacity(bookingCapacity, soldGuests);

  const limitedPackages = packages.some((pkg) => pkg.inventoryUnits != null && pkg.inventoryUnits >= 0);
  const needsSoldUnits = limitedPackages || roomInventory != null;
  const soldByKey: Record<string, number> = {};
  if (needsSoldUnits) {
    for (const summary of summaries) {
      const units = packageUnitsFromSelections(summary.selections, packages, summary.accommodationGuests);
      for (const [key, qty] of Object.entries(units)) soldByKey[key] = (soldByKey[key] ?? 0) + qty;
    }
  }
  const remainingRoomInventory = remainingHotelRoomInventory(roomInventory, totalPackageUnits(soldByKey));

  const packagesForPublic = needsSoldUnits ? withPackageRemainingUnits(packages, soldByKey, remainingRoomInventory) : packages.map((pkg) => ({ ...pkg, remainingUnits: null }));
  const availablePackages = filterAvailablePackages(packagesForPublic);

  if (
    !isHotelPubliclyAvailable({
      remainingCapacity,
      remainingRoomInventory,
      accommodationMode: mode,
      availablePackages,
      hadLimitedPackages: limitedPackages,
      hadRoomInventory: roomInventory != null,
    })
  ) {
    return null;
  }

  return {
    id: String(hotel._id),
    name: hotel.name,
    description: hotel.description,
    address: hotel.address,
    distanceFromVenueKm: hotel.distanceFromVenueKm ?? null,
    gallery: hotel.gallery,
    currency: normalizeTBookCurrency(hotel.currency),
    bookingCapacity,
    remainingCapacity,
    roomInventory,
    remainingRoomInventory,
    registrationFieldSchema: hotel.registrationFieldSchema ?? [],
    pricing: { ...pricing, packages: availablePackages },
  };
}

export interface PublicEventDetail {
  event: ReturnType<typeof serializePublicEvent>;
  groupBookingOptions: IEventGroup["defaultBookingOptions"];
  hotels: PublicHotelListing[];
}

export async function getPublicEventDetail(groupId: string, eventId: string): Promise<PublicEventDetail | null> {
  const event = await eventRepository.findById(eventId);
  if (!event || String(event.groupId) !== groupId || event.status !== "active") return null;

  const group = await eventGroupRepository.findById(groupId);
  const org = group?.organizationId ? await organizationRepository.findById(String(group.organizationId)) : null;
  const embedConfig = resolveTDartsEmbedConfig(org);

  const hotels = await hotelRepository.findByGroupId(groupId);
  const activeHotels = hotels.filter((h) => h.status === "active");
  const serializedHotels = (await Promise.all(activeHotels.map(serializePublicHotel))).filter((h): h is PublicHotelListing => h != null);

  return {
    event: serializePublicEvent(event, group, embedConfig),
    groupBookingOptions: group?.defaultBookingOptions ?? [],
    hotels: serializedHotels,
  };
}

// ---- Public entry list ------------------------------------------------------------

export interface PublicEntryList {
  eventName: string;
  teams: Array<{ label: string; members: string[] }>;
}

/**
 * Who has entered a team event, for the storefront's public entry list
 * (shown for events with `publicEntryList` on and no tDarts bracket).
 * Port of the legacy plugin's `getPublicEntryList`: one row per paid team,
 * labelled by the team's first registration field (else the buyer's name),
 * members by each player's first field. Null when the event isn't in the
 * group, isn't active, or doesn't publish its list.
 */
export async function getPublicEntryList(groupId: string, eventId: string): Promise<PublicEntryList | null> {
  const event = await eventRepository.findById(eventId);
  if (!event || String(event.groupId) !== groupId || event.status !== "active" || !event.publicEntryList) return null;

  const bookings = await BookingModel.find(
    { eventId: event._id, status: { $in: ["paid", "confirmed"] } },
    { attendees: 1, attendeeFieldSchema: 1, teamMemberFieldSchema: 1, customer: 1 },
  )
    .sort({ paidAt: 1, createdAt: 1 })
    .lean()
    .exec();

  const firstFieldValue = (schema: Array<{ key: string }> | undefined, fields: Record<string, unknown> | undefined): string | null => {
    const key = schema?.[0]?.key;
    const raw = key && fields ? fields[key] : null;
    return raw != null && String(raw).trim() ? String(raw).trim() : null;
  };

  let index = 0;
  const teams = bookings.flatMap((booking) =>
    (booking.attendees ?? []).map((attendee) => {
      index += 1;
      // A walk-in sale has no real buyer name, so never show its placeholder.
      const buyer = booking.customer?.email === WALK_IN_CUSTOMER_EMAIL ? null : booking.customer?.name;
      return {
        label: firstFieldValue(booking.attendeeFieldSchema, attendee.fields as Record<string, unknown>) ?? buyer ?? `Csapat #${index}`,
        members: (attendee.members ?? [])
          .map((member) => firstFieldValue(booking.teamMemberFieldSchema, member.fields as Record<string, unknown>))
          .filter((name): name is string => Boolean(name)),
      };
    }),
  );
  return { eventName: event.name, teams };
}
