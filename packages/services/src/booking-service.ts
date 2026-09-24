import { Types } from "mongoose";
import { ActionError } from "@tbook/actions";
import {
  bookingRepository,
  eventGroupRepository,
  eventNights,
  eventRepository,
  hotelRepository,
  type IBooking,
  type IEvent,
  type IHotel,
} from "@tbook/db";
import {
  calculateBookingQuote,
  normalizeHotelPricing,
  packageUnitsFromSelections,
  remainingHotelBookingCapacity,
  remainingHotelRoomInventory,
  totalPackageUnits,
  validateEligibility,
  validateHotelSelections,
  validateSelections,
  type EligibilityRulesConfig,
  type PriceQuoteResult,
} from "@tbook/domain";
import {
  VALID_BOOKING_STATUS_TRANSITIONS,
  type AttendeeFieldDef,
  type BillingInfo,
  type BookingAttendee,
  type BookingStatus,
  type Customer,
  type Selections,
} from "@tbook/schemas";
import {
  accommodationGuestCount,
  countRosterPlayers,
  getEventSalesState,
  mergeRegistrationFieldSchemas,
  normalizeAttendeePayload,
  resolvePlayersPerTicket,
  resolveTeamMemberFieldSchema,
  resolveTicketAttendeeFieldSchema,
  validateAttendees,
} from "./booking-validation";

/**
 * Ported from the legacy plugin's services/booking-service.ts. Two scope
 * boundaries vs. the legacy version, both deliberate (per the approved
 * plan and the fork directive for this pass):
 *
 * 1. Only the single-event quote/createPendingBooking path is ported here
 *    — quoteMulti/createPendingMultiBookings and the admin listing methods
 *    (listBookingsAdmin/listBookingsForExport/listSelectionFacets) are
 *    deferred to a later pass.
 * 2. Stripe checkout session creation, invoice issuance, tDarts sync,
 *    voucher PDF issuance, and email sending are NOT called from here —
 *    that orchestration belongs to a not-yet-built checkout-service.ts.
 *    createPendingBooking only ever produces a `status: "pending"` booking.
 *
 * The one structural change from a straight port: event capacity is
 * reserved via an atomic eventRepository.reserveCapacity/releaseCapacity
 * pair (see event-repository.ts) instead of the legacy's read-then-write
 * aggregate-count check — that was a real oversell race under concurrent
 * checkouts. Hotel/package inventory checks below are NOT made atomic
 * (ported faithfully as read-then-compare, matching the legacy behavior) —
 * only the event-capacity race was in scope for this pass; the same class
 * of race technically still exists for hotel capacity and would need the
 * same reserve/release treatment in a follow-up.
 */

const ACTIVE_HOLD_STATUSES: BookingStatus[] = ["pending", "checkout_started", "paid", "confirmed"];

function oid(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

export interface QuoteRequest {
  eventId: string;
  guests: number;
  accommodationGuests?: number | null;
  teamMemberCount?: number | null;
  hotelId?: string | null;
  nights?: number | null;
  selections?: Selections | null;
}

export interface BookingQuoteContext {
  event: IEvent;
  quote: PriceQuoteResult;
  hotelName: string;
  nights: number;
  selections: Selections;
  currency: string;
  registrationFieldSchema: AttendeeFieldDef[];
  teamMemberFieldSchema: AttendeeFieldDef[];
}

/**
 * Server-side price calculation for an event + optional hotel + selections.
 * Used by the admin live preview, the public quote endpoint, and booking
 * creation — client-provided totals are never trusted.
 */
export async function quote(input: QuoteRequest, opts?: { groupId?: string }): Promise<BookingQuoteContext> {
  const event = await eventRepository.findById(input.eventId);
  if (!event || event.status !== "active") throw ActionError.notFound("Event not found or inactive.");
  if (opts?.groupId && String(event.groupId) !== opts.groupId) throw ActionError.notFound("Event not found or inactive.");

  const salesState = getEventSalesState(event);
  if (salesState !== "on_sale") {
    throw ActionError.validation(salesState === "upcoming" ? "Ticket sales have not opened yet." : "Ticket sales are closed.", { salesState });
  }

  const group = event.groupId ? await eventGroupRepository.findById(String(event.groupId)) : null;
  const groupOptions = group?.defaultBookingOptions ?? [];

  const selections: Selections = input.selections ?? {};
  const maxHotelGuests = accommodationGuestCount(input.guests, event);
  const teamMemberCount = Math.min(maxHotelGuests, Math.max(1, Math.floor(input.teamMemberCount ?? countRosterPlayers(null, event, input.guests))));

  let hotelGuests = input.accommodationGuests == null ? maxHotelGuests : input.accommodationGuests;
  if (hotelGuests > maxHotelGuests) {
    throw ActionError.validation(`Accommodation guests cannot exceed ${maxHotelGuests} (${input.guests} entries).`);
  }

  let hotelName = "";
  let hotelRegistrationFields: AttendeeFieldDef[] = [];
  let accommodation: IHotel["pricing"] | null = null;
  let nights = 0;

  const wantsHotel = Boolean(input.hotelId) && hotelGuests > 0;

  if (wantsHotel && input.hotelId) {
    const hotel = await hotelRepository.findById(input.hotelId);
    const belongsToEvent =
      hotel != null &&
      hotel.status === "active" &&
      (event.groupId
        ? (hotel.groupId != null && String(hotel.groupId) === String(event.groupId)) || (hotel.eventId != null && String(hotel.eventId) === String(event._id))
        : hotel.eventId != null && String(hotel.eventId) === String(event._id));
    if (!hotel || !belongsToEvent) throw ActionError.notFound("Hotel not found for this event.");

    const errors = validateHotelSelections(hotel.pricing, selections, hotelGuests);
    if (errors.length > 0) throw ActionError.validation(errors.map((e) => e.message).join(" "), { errors });

    accommodation = hotel.pricing;
    hotelName = hotel.name;
    hotelRegistrationFields = hotel.registrationFieldSchema ?? [];
    nights = input.nights ?? eventNights(event);
  } else if (groupOptions.length > 0) {
    hotelGuests = 0;
    const errors = validateSelections(groupOptions, selections);
    if (errors.length > 0) throw ActionError.validation(errors.map((e) => e.message).join(" "), { errors });
  } else {
    hotelGuests = 0;
  }

  const quoteResult = calculateBookingQuote({
    ticketFeeHuf: event.ticketFeeHuf,
    ticketFeeMode: event.ticketFeeMode,
    ticketPriceBasis: event.ticketPriceBasis,
    ticketVatPercent: event.ticketVatPercent,
    guests: input.guests,
    accommodationGuests: hotelGuests,
    nights,
    accommodation,
    groupOptions,
    groupPriceBasis: group?.defaultPriceBasis,
    groupVatPercent: group?.defaultVatPercent,
    selections,
    pricingRules: event.pricingRules ?? null,
    playersPerTicket: resolvePlayersPerTicket(event),
    teamMemberCount,
  });

  return {
    event,
    quote: quoteResult,
    hotelName,
    nights: quoteResult.nights,
    selections,
    currency: event.currency,
    registrationFieldSchema: mergeRegistrationFieldSchemas(
      resolveTicketAttendeeFieldSchema({
        registrationUnit: event.registrationUnit,
        groupSchema: group?.defaultAttendeeFieldSchema,
        eventSchema: event.attendeeFieldSchema,
        mode: event.attendeeFieldSchemaMode,
      }),
      hotelRegistrationFields,
    ),
    teamMemberFieldSchema: resolveTeamMemberFieldSchema({
      registrationUnit: event.registrationUnit,
      groupSchema: group?.defaultAttendeeFieldSchema,
      eventTeamMemberSchema: event.teamMemberFieldSchema,
      eventTicketSchema: event.attendeeFieldSchema,
      mode: event.attendeeFieldSchemaMode,
    }),
  };
}

/**
 * Non-atomic (matches legacy): re-derives sold units for a hotel from its
 * active bookings and throws if the requested selection would exceed
 * hotel-wide guest capacity, shared room inventory, or a specific
 * package's inventory allotment.
 */
async function assertHotelInventoryAvailable(hotel: IHotel, selections: Selections, accommodationGuests: number): Promise<void> {
  const pricing = normalizeHotelPricing(hotel.pricing);
  const packages = pricing.packages ?? [];

  if (hotel.bookingCapacity != null && hotel.bookingCapacity >= 0 && accommodationGuests > 0) {
    const summaries = await bookingRepository.findAccommodationSummariesByHotel(String(hotel._id), ACTIVE_HOLD_STATUSES);
    const soldGuests = summaries.reduce((sum, s) => sum + s.accommodationGuests, 0);
    const remaining = remainingHotelBookingCapacity(hotel.bookingCapacity, soldGuests);
    if (remaining != null && accommodationGuests > remaining) {
      throw ActionError.validation(remaining === 0 ? "This hotel is fully booked." : `Only ${remaining} accommodation spot(s) left at this hotel (you need ${accommodationGuests}).`);
    }
  }

  const requestedUnits = packageUnitsFromSelections(selections, packages, accommodationGuests);
  if (Object.keys(requestedUnits).length === 0) return;

  const summaries = await bookingRepository.findAccommodationSummariesByHotel(String(hotel._id), ACTIVE_HOLD_STATUSES);
  const soldByKey: Record<string, number> = {};
  for (const summary of summaries) {
    const units = packageUnitsFromSelections(summary.selections, packages, summary.accommodationGuests);
    for (const [key, qty] of Object.entries(units)) soldByKey[key] = (soldByKey[key] ?? 0) + qty;
  }

  if (hotel.roomInventory != null && hotel.roomInventory >= 0) {
    const requestedTotal = totalPackageUnits(requestedUnits);
    if (requestedTotal > 0) {
      const remaining = remainingHotelRoomInventory(hotel.roomInventory, totalPackageUnits(soldByKey));
      if (remaining != null && requestedTotal > remaining) {
        throw ActionError.validation(remaining === 0 ? "This hotel has no rooms left." : `Only ${remaining} room(s) left at this hotel (you need ${requestedTotal}).`);
      }
    }
  }

  for (const [key, qty] of Object.entries(requestedUnits)) {
    const pkg = packages.find((p) => p.key === key);
    if (!pkg || pkg.inventoryUnits == null || pkg.inventoryUnits < 0) continue;
    const remaining = Math.max(0, pkg.inventoryUnits - (soldByKey[key] ?? 0));
    if (qty > remaining) {
      throw ActionError.validation(remaining === 0 ? `No rooms left for "${pkg.label}".` : `Only ${remaining} room(s) left for "${pkg.label}" (you need ${qty}).`);
    }
  }
}

export interface CreateBookingInput {
  eventId: string;
  guests: number;
  accommodationGuests?: number | null;
  teamMemberCount?: number | null;
  hotelId?: string | null;
  nights?: number | null;
  selections?: Selections | null;
  customer: Customer;
  billing?: BillingInfo | null;
  returnBaseUrl?: string | null;
  attendees?: BookingAttendee[] | null;
}

/**
 * Creates a pending booking with a server-calculated quote. Payment
 * (Stripe) is initiated separately by the not-yet-built checkout-service.
 *
 * Capacity handling: event capacity is reserved atomically BEFORE any
 * further validation runs. If any check after that point fails (hotel
 * inventory, attendee validation, eligibility), the reservation is rolled
 * back via a compensating releaseCapacity call before the error is
 * re-thrown — this repo has no multi-document Mongo transaction wired up
 * (would need a replica-set-mode test double), so reserve-then-compensate
 * is the chosen alternative to a single all-or-nothing transaction.
 */
export async function createPendingBooking(input: CreateBookingInput, opts?: { groupId?: string }): Promise<IBooking> {
  const inferredTeamMemberCount =
    input.attendees && input.attendees.length > 0
      ? countRosterPlayers(input.attendees, { registrationUnit: "team", teamMemberLimit: 100 }, input.guests)
      : (input.teamMemberCount ?? undefined);

  const ctx = await quote({ ...input, teamMemberCount: inferredTeamMemberCount }, opts);
  const { event, quote: priceQuote, hotelName, nights, selections, currency, registrationFieldSchema, teamMemberFieldSchema } = ctx;

  let capacityReserved = false;
  if (event.capacity != null) {
    const reserved = await eventRepository.reserveCapacity(String(event._id), input.guests);
    if (!reserved) throw ActionError.validation("Not enough capacity left for this event.");
    capacityReserved = true;
  }

  try {
    const hasHotel = Boolean(hotelName) && (priceQuote.accommodationGuests ?? 0) > 0;

    if (hasHotel && input.hotelId) {
      const hotel = await hotelRepository.findById(input.hotelId);
      if (hotel) await assertHotelInventoryAvailable(hotel, selections, priceQuote.accommodationGuests ?? input.guests);
    }

    const playersPerTicket = resolvePlayersPerTicket(event);
    const attendeeIssues = validateAttendees(registrationFieldSchema, input.guests, input.attendees, event.registrationUnit, {
      teamMemberFieldSchema,
      teamMemberLimit: event.teamMemberLimit ?? null,
      playersPerTicket: playersPerTicket > 1 ? playersPerTicket : null,
    });
    if (attendeeIssues.length > 0) throw ActionError.validation("Please check the attendee details.", { issues: attendeeIssues });

    // @tbook/schemas types eligibilityFormRules.rules[].op as a plain string (persistence-layer,
    // matches the legacy Mongoose shape); @tbook/domain narrows it to EligibilityMatchOp for its
    // own type safety. The admin rule editor (Phase 5) is the only writer, so the value is always
    // one of the known ops at runtime — this cast just bridges the two packages' type strictness.
    const eligibilityIssues = validateEligibility(
      { ...event, eligibilityFormRules: event.eligibilityFormRules as EligibilityRulesConfig | null },
      input.attendees,
      registrationFieldSchema,
      teamMemberFieldSchema,
      playersPerTicket > 1 ? playersPerTicket : null,
    );
    if (eligibilityIssues.length > 0) throw ActionError.validation("This event has eligibility requirements that are not met.", { issues: eligibilityIssues });

    const attendees = normalizeAttendeePayload(registrationFieldSchema, input.attendees, teamMemberFieldSchema);
    const group = event.groupId ? await eventGroupRepository.findById(String(event.groupId)) : null;

    return await bookingRepository.create({
      organizationId: group?.organizationId ?? event.organizationId ?? null,
      groupId: event.groupId,
      eventId: event._id,
      hotelId: hasHotel && input.hotelId ? oid(input.hotelId) : null,
      eventName: event.name,
      groupName: group?.name ?? "",
      hotelName: hasHotel ? hotelName : "",
      customer: {
        name: input.customer.name.trim(),
        email: input.customer.email.trim().toLowerCase(),
        phone: input.customer.phone.trim(),
        note: input.customer.note?.trim() ?? "",
      },
      billing: input.billing ?? null,
      checkoutReturnBaseUrl: input.returnBaseUrl?.trim() || null,
      attendeeFieldSchema: registrationFieldSchema,
      teamMemberFieldSchema,
      teamMemberLimit: event.teamMemberLimit ?? null,
      playersPerTicket,
      attendees,
      guests: input.guests,
      nights,
      selections,
      quote: priceQuote,
      totalHuf: priceQuote.totalHuf,
      currency,
      status: "pending",
    });
  } catch (error) {
    if (capacityReserved) await eventRepository.releaseCapacity(String(event._id), input.guests);
    throw error;
  }
}

/** Throws unless the transition is allowed by VALID_BOOKING_STATUS_TRANSITIONS (@tbook/schemas). */
export function assertValidBookingStatusTransition(current: BookingStatus, next: BookingStatus): void {
  const allowed = VALID_BOOKING_STATUS_TRANSITIONS[current] ?? [];
  if (!allowed.includes(next)) {
    throw ActionError.validation(`Invalid booking status transition: ${current} → ${next}`);
  }
}

/**
 * Flips a pending|checkout_started booking to expired and releases its
 * event-capacity reservation. Idempotent — a booking that's already
 * expired, paid, cancelled, etc. is left untouched rather than throwing,
 * matching Stripe webhook retry semantics (a webhook may fire more than
 * once for the same session expiry).
 */
export async function expireBooking(bookingId: string): Promise<IBooking | null> {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) return null;
  if (booking.status !== "pending" && booking.status !== "checkout_started") return booking;

  const updated = await bookingRepository.updateById(bookingId, { status: "expired" });
  const event = await eventRepository.findById(String(booking.eventId));
  if (event?.capacity != null) {
    await eventRepository.releaseCapacity(String(booking.eventId), booking.guests);
  }
  return updated;
}
