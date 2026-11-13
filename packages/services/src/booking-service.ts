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
  DAY_PASS_SELECTION_KEY,
  calculateBookingQuote,
  calculateDayPassQuote,
  dayCapacity,
  normalizeHotelPricing,
  packageUnitsFromSelections,
  remainingHotelBookingCapacity,
  remainingHotelRoomInventory,
  parseDayTickets,
  resolveDayPassDiscountCode,
  todayDayKey,
  totalDayTickets,
  totalPackageUnits,
  validateDayTickets,
  collectListLookups,
  validateEligibility,
  validateHotelSelections,
  validateSelections,
  type DayTickets,
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
  attendeeIssuesMessage,
  countRosterPlayers,
  eligibilityIssuesMessage,
  getEventSalesState,
  mergeRegistrationFieldSchemas,
  normalizeAttendeePayload,
  resolvePlayersPerTicket,
  resolveTeamMemberFieldSchema,
  resolveTicketAttendeeFieldSchema,
  validateAttendees,
} from "./booking-validation";
import { loadDataListMembership } from "./data-list-service";
import { resolveModules } from "./module-registry";
import {
  assignAttendeeIdentity,
  checkUniqueFieldValues,
  claimUniqueFieldValues,
  newRegistrationNumber,
  releaseBookingExtensions,
  resolveFieldChoices,
  runRegistrationReservers,
} from "./registration-pipeline";

/**
 * Ported from the legacy plugin's services/booking-service.ts. Two scope
 * boundaries vs. the legacy version, both deliberate (per the approved
 * plan and the fork directive for this pass):
 *
 * 1. Only the single-event quote/createPendingBooking path lives here.
 *    Multi-event booking (quoteMulti/createPendingMultiBookings) is in
 *    multi-booking-service.ts and builds on these two functions.
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
  /** Day-pass events only: a percent-off code applied to every day's price in the basket. */
  discountCode?: string | null;
}

export interface BookingQuoteContext {
  event: IEvent;
  /**
   * Entries being bought. Equals the requested `guests` for a standard
   * event; for a day-pass event it is the size of the day basket, because
   * the basket — not a separate number — is what the buyer is paying for.
   */
  guests: number;
  /** The validated day basket (day-pass events only). */
  dayTickets: DayTickets | null;
  /** The resolved discount code's own `code`, for the booking record — null when none was applied. */
  discountCode: string | null;
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
/**
 * Admin-only relaxations of the rules the public booking path enforces.
 *
 * Every one of these defaults to off, so the storefront and the v1 API are
 * unaffected. They exist because an org manager's job routinely includes
 * cases the public flow must refuse: recording a bank transfer that arrived
 * after sales closed, adding a competitor the organizer agreed to take past
 * a sold-out cap, or registering someone whose eligibility the organizer has
 * verified by other means.
 */
export interface BookingPolicyOverrides {
  /** Register into an event whose sales window has closed or not yet opened. */
  allowClosedSales?: boolean;
  /** Register into a draft or archived event. */
  allowInactiveEvent?: boolean;
  /** Register past the event's capacity cap. */
  allowOverCapacity?: boolean;
  /** Bypass the event's eligibility rules. */
  skipEligibility?: boolean;
}

/** Thrown when the event (or the overall cap) has no room for the requested guests. */
export function capacityFullError(): ActionError {
  return new ActionError(400, "capacity_full", "Sajnos elfogytak a szabad helyek erre az eseményre.");
}

export type QuoteOptions = {
  groupId?: string;
  /**
   * Test booking (v1 preview key + X-TBook-Test): saved with `isTest`,
   * takes no event capacity, day passes or module seats, and claims its
   * unique answers in the test namespace — live data is never affected.
   */
  isTest?: boolean;
} & BookingPolicyOverrides;

export async function quote(input: QuoteRequest, opts?: QuoteOptions): Promise<BookingQuoteContext> {
  const event = await eventRepository.findById(input.eventId);
  if (!event) throw ActionError.notFound("Event not found or inactive.");
  if (event.status !== "active" && !opts?.allowInactiveEvent) throw ActionError.notFound("Event not found or inactive.");
  if (opts?.groupId && String(event.groupId) !== opts.groupId) throw ActionError.notFound("Event not found or inactive.");

  const salesState = getEventSalesState(event);
  if (salesState !== "on_sale" && !opts?.allowClosedSales) {
    throw new ActionError(400, "sales_closed", salesState === "upcoming" ? "A regisztráció még nem indult el." : "A regisztráció lezárult.", { salesState });
  }

  const group = event.groupId ? await eventGroupRepository.findById(String(event.groupId)) : null;

  if (event.kind === "day_pass") return quoteDayPass(event, group, input, opts);

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
    guests: input.guests,
    dayTickets: null,
    discountCode: null,
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
 * Quote for a day-pass event: the buyer's basket of `date → passes` is the
 * whole order. Hotels and group add-ons are deliberately not combined with
 * passes — a day pass is a ticket for one day, not a stay.
 */
async function quoteDayPass(
  event: IEvent,
  group: Awaited<ReturnType<typeof eventGroupRepository.findById>>,
  input: QuoteRequest,
  opts?: QuoteOptions,
): Promise<BookingQuoteContext> {
  if (!event.dayPass) throw ActionError.validation("This day-pass event has no pass pricing configured.");

  const { tickets, errors } = parseDayTickets((input.selections ?? {}) as Record<string, unknown>);
  if (errors.length > 0) throw ActionError.validation(errors.join(" "), { errors });

  const issues = validateDayTickets({
    config: event.dayPass,
    startDate: event.startDate,
    endDate: event.endDate,
    tickets,
    daySold: event.daySold as Record<string, number> | undefined,
    today: todayDayKey(new Date()),
    // Selling a day that has started is a counter/console decision, tied to
    // the same override that lets a manager sell outside the sales window.
    allowPastDays: opts?.allowClosedSales,
    allowOverCapacity: opts?.allowOverCapacity || opts?.isTest,
  });
  if (issues.length > 0) throw ActionError.validation(issues.map((issue) => issue.message).join(" "), { issues });

  const discount = resolveDayPassDiscountCode(event.dayPass, input.discountCode);
  if (input.discountCode && !discount) {
    throw ActionError.validation("This discount code isn't valid for this event.");
  }

  const priceQuote = calculateDayPassQuote({
    config: event.dayPass,
    tickets,
    priceBasis: event.ticketPriceBasis,
    vatPercent: event.ticketVatPercent,
    discount,
  });

  return {
    event,
    guests: totalDayTickets(tickets),
    dayTickets: tickets,
    discountCode: discount?.code ?? null,
    quote: priceQuote,
    hotelName: "",
    nights: 0,
    selections: { [DAY_PASS_SELECTION_KEY]: tickets },
    currency: event.currency,
    registrationFieldSchema: mergeRegistrationFieldSchemas(
      resolveTicketAttendeeFieldSchema({
        registrationUnit: event.registrationUnit,
        groupSchema: group?.defaultAttendeeFieldSchema,
        eventSchema: event.attendeeFieldSchema,
        mode: event.attendeeFieldSchemaMode,
      }),
      [],
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
  /** Day-pass events only: a percent-off code applied to every day's price in the basket. */
  discountCode?: string | null;
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
export async function createPendingBooking(input: CreateBookingInput, opts?: QuoteOptions): Promise<IBooking> {
  return (await buildPendingBooking(input, opts, false))!;
}

export interface BookingPreview {
  totalHuf: number;
  guests: number;
  /** The organization/group/event context, for a caller that decides the confirmation path. */
  event: IEvent;
}

/**
 * Preview mode (dry run): every check createPendingBooking makes — form,
 * rules, `unique` answers and module holds, capacity, module reservations
 * such as bus seats — without reserving or saving anything.
 */
export async function previewPendingBooking(input: CreateBookingInput, opts?: QuoteOptions): Promise<BookingPreview> {
  const ctx = await quote(
    {
      ...input,
      teamMemberCount:
        input.attendees && input.attendees.length > 0
          ? countRosterPlayers(input.attendees, { registrationUnit: "team", teamMemberLimit: 100 }, input.guests)
          : (input.teamMemberCount ?? undefined),
    },
    opts,
  );
  await buildPendingBooking(input, opts, true, ctx);
  return { totalHuf: ctx.quote.totalHuf, guests: ctx.guests, event: ctx.event };
}

async function buildPendingBooking(input: CreateBookingInput, opts: QuoteOptions | undefined, dryRun: boolean, quoted?: BookingQuoteContext): Promise<IBooking | null> {
  const inferredTeamMemberCount =
    input.attendees && input.attendees.length > 0
      ? countRosterPlayers(input.attendees, { registrationUnit: "team", teamMemberLimit: 100 }, input.guests)
      : (input.teamMemberCount ?? undefined);

  const ctx = quoted ?? (await quote({ ...input, teamMemberCount: inferredTeamMemberCount }, opts));
  const { event, quote: priceQuote, hotelName, nights, selections, discountCode, currency, registrationFieldSchema, teamMemberFieldSchema, guests } = ctx;

  // Per-day passes are reserved first: it is the stricter, multi-counter
  // reservation, and if the optional overall cap then fails we release it.
  let dayReserved: DayTickets | null = null;
  const isTest = Boolean(opts?.isTest);
  if (isTest) {
    // Test bookings stand apart from live capacity: nothing to reserve or check.
  } else if (dryRun) {
    // Day baskets were checked against live availability in quote(); only the overall cap is left.
    if (event.capacity != null && !opts?.allowOverCapacity && event.capacity - (event.soldGuestCount ?? 0) < guests) throw capacityFullError();
  } else if (ctx.dayTickets && event.dayPass) {
    const dayConfig = event.dayPass;
    const reservedDays = opts?.allowOverCapacity
      ? await eventRepository.reserveDayCapacityUnchecked(String(event._id), ctx.dayTickets)
      : await eventRepository.reserveDayCapacity(
          String(event._id),
          ctx.dayTickets,
          Object.fromEntries(Object.keys(ctx.dayTickets).map((day) => [day, dayCapacity(dayConfig, day)])),
        );
    if (!reservedDays) throw ActionError.validation("One of the selected days just sold out. Please pick again.");
    dayReserved = ctx.dayTickets;
  }

  let capacityReserved = false;
  if (event.capacity != null && !dryRun && !isTest) {
    // The unchecked variant is a separate repository method, so an
    // over-capacity write can only happen when a caller explicitly asks.
    const reserved = opts?.allowOverCapacity
      ? await eventRepository.reserveCapacityUnchecked(String(event._id), guests)
      : await eventRepository.reserveCapacity(String(event._id), guests);
    if (!reserved) {
      if (dayReserved) await eventRepository.releaseDayCapacity(String(event._id), dayReserved);
      throw capacityFullError();
    }
    capacityReserved = true;
  }

  let releaseClaims: (() => Promise<void>) | null = null;
  let releaseReservations: (() => Promise<void>) | null = null;

  try {
    const hasHotel = Boolean(hotelName) && (priceQuote.accommodationGuests ?? 0) > 0;
    const group = event.groupId ? await eventGroupRepository.findById(String(event.groupId)) : null;
    const organizationId = group?.organizationId ?? event.organizationId ?? null;
    const extensionCtx = {
      event,
      organizationId: organizationId ? String(organizationId) : null,
      groupId: event.groupId ? String(event.groupId) : null,
      modules: await resolveModules({ organizationId: organizationId ? String(organizationId) : null, groupId: event.groupId ? String(event.groupId) : null, event }),
      isTest,
    };
    // Selects whose choices come from a module (e.g. bus routes) are filled
    // before validation, so an answer outside the live choices is refused.
    const { schema: fieldSchema } = await resolveFieldChoices(registrationFieldSchema, extensionCtx);

    if (hasHotel && input.hotelId) {
      const hotel = await hotelRepository.findById(input.hotelId);
      if (hotel && !isTest) await assertHotelInventoryAvailable(hotel, selections, priceQuote.accommodationGuests ?? guests);
    }

    const playersPerTicket = resolvePlayersPerTicket(event);
    const attendeeIssues = validateAttendees(fieldSchema, guests, input.attendees, event.registrationUnit, {
      teamMemberFieldSchema,
      teamMemberLimit: event.teamMemberLimit ?? null,
      playersPerTicket: playersPerTicket > 1 ? playersPerTicket : null,
    });
    if (attendeeIssues.length > 0) throw ActionError.validation(attendeeIssuesMessage(attendeeIssues, fieldSchema), { issues: attendeeIssues });

    // @tbook/schemas types eligibilityFormRules.rules[].op as a plain string (persistence-layer,
    // matches the legacy Mongoose shape); @tbook/domain narrows it to EligibilityMatchOp for its
    // own type safety. The admin rule editor (Phase 5) is the only writer, so the value is always
    // one of the known ops at runtime — this cast just bridges the two packages' type strictness.
    // A Mongoose document must become a plain object before spreading: a
    // spread copies its internals, not its fields, which silently dropped
    // every eligibility rule here before (rules were never enforced).
    const eventFields = typeof (event as { toObject?: () => unknown }).toObject === "function" ? (event as unknown as { toObject: () => typeof event }).toObject() : event;
    const eligibilityEvent = { ...eventFields, eligibilityFormRules: event.eligibilityFormRules as EligibilityRulesConfig | null };
    const eligibilityIssues = opts?.skipEligibility
      ? []
      : validateEligibility(eligibilityEvent, input.attendees, fieldSchema, teamMemberFieldSchema, playersPerTicket > 1 ? playersPerTicket : null, {
          listMembership: await loadDataListMembership(extensionCtx.organizationId, collectListLookups(eligibilityEvent, input.attendees)),
        });
    if (eligibilityIssues.length > 0) throw ActionError.validation(eligibilityIssuesMessage(eligibilityIssues), { issues: eligibilityIssues });

    const attendees = assignAttendeeIdentity(normalizeAttendeePayload(fieldSchema, input.attendees, teamMemberFieldSchema));
    const bookingId = new Types.ObjectId();
    if (dryRun) {
      await checkUniqueFieldValues(extensionCtx, attendees, fieldSchema);
      await runRegistrationReservers(extensionCtx, String(bookingId), attendees, fieldSchema, { dryRun: true });
      return null;
    }
    releaseClaims = await claimUniqueFieldValues(extensionCtx, String(bookingId), attendees, fieldSchema);
    releaseReservations = await runRegistrationReservers(extensionCtx, String(bookingId), attendees, fieldSchema);

    return await bookingRepository.create({
      _id: bookingId,
      registrationNumber: newRegistrationNumber(),
      organizationId: organizationId,
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
      attendeeFieldSchema: fieldSchema,
      teamMemberFieldSchema,
      teamMemberLimit: event.teamMemberLimit ?? null,
      playersPerTicket,
      attendees,
      guests: guests,
      nights,
      selections,
      discountCode,
      quote: priceQuote,
      totalHuf: priceQuote.totalHuf,
      currency,
      status: "pending",
      isTest,
    });
  } catch (error) {
    if (releaseReservations) await releaseReservations();
    if (releaseClaims) await releaseClaims();
    if (capacityReserved) await eventRepository.releaseCapacity(String(event._id), guests);
    if (dayReserved) await eventRepository.releaseDayCapacity(String(event._id), dayReserved);
    throw error;
  }
}

/**
 * Gives back everything createPendingBooking reserved for a booking: the
 * event-wide count for a capped event, and each day's passes for a
 * day-pass event. Mirrors the reservation exactly, so only what was
 * actually reserved is released.
 */
async function releaseBookingCapacity(booking: IBooking): Promise<void> {
  // A test booking never reserved anything.
  if (booking.isTest) return;
  const event = await eventRepository.findById(String(booking.eventId));
  if (!event) return;

  if (event.capacity != null) {
    await eventRepository.releaseCapacity(String(booking.eventId), booking.guests);
  }
  if (event.kind === "day_pass") {
    const { tickets } = parseDayTickets(booking.selections as Record<string, unknown>);
    if (Object.keys(tickets).length > 0) await eventRepository.releaseDayCapacity(String(booking.eventId), tickets);
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
  await releaseBookingCapacity(booking);
  await releaseBookingExtensions(booking, "expired");
  return updated;
}

/**
 * Admin cancellation. Releases the event-capacity reservation that
 * createPendingBooking took — the gap this closes is real: before this
 * existed, only expireBooking released capacity, so a cancelled booking
 * held its seats forever and the event silently lost sellable capacity
 * (and `soldGuestCount` drifted permanently above the true total).
 *
 * Voucher voiding is the caller's job (voucher-service's
 * voidVouchersForBooking) rather than something done here, to keep this
 * module free of a dependency on voucher-service — see
 * booking-admin-service.cancelBookingAsAdmin, which composes the two.
 *
 * Idempotent: a booking already cancelled is returned untouched instead of
 * throwing, and capacity is only released once (the status check is what
 * guarantees that).
 */
export async function cancelBooking(bookingId: string, opts: { reason?: string } = {}): Promise<IBooking | null> {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) return null;
  if (booking.status === "cancelled") return booking;

  assertValidBookingStatusTransition(booking.status, "cancelled");

  const reason = opts.reason?.trim();
  // Append rather than overwrite — the guest's own checkout note is often
  // what explains the cancellation in the first place.
  const note = reason ? [booking.customer?.note, `[cancelled] ${reason}`].filter(Boolean).join("\n") : null;
  const updated = await bookingRepository.markCancelled(bookingId, note);

  await releaseBookingCapacity(booking);
  await releaseBookingExtensions(booking, "cancelled");

  return updated;
}

/**
 * Admin confirmation of a paid booking (paid → confirmed). Capacity stays
 * reserved across this transition, so nothing to adjust — this is purely a
 * bookkeeping state the admin drives, which is why it lives here next to
 * the other transitions rather than in the admin read-model service.
 */
export async function confirmBooking(bookingId: string): Promise<IBooking | null> {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) return null;
  if (booking.status === "confirmed") return booking;

  assertValidBookingStatusTransition(booking.status, "confirmed");
  return bookingRepository.updateById(bookingId, { status: "confirmed" });
}
