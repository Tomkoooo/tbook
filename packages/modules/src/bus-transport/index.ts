import { eventRepository } from "@tbook/db";
import { extensions, registerImportTarget, registerModule } from "@tbook/services";
import {
  BUS_ROUTES_SOURCE,
  BUS_WAITLIST_LABEL,
  BUS_WAITLIST_VALUE,
  attendeeAwaitsBus,
  attendeeOnBusWaitlist,
  busForAttendee,
  busRouteFields,
  formatDeparture,
  listRoutes,
  releaseSeatsForBooking,
  reserveSeats,
  routeChoices,
  seatsByRoute,
  upsertRoutesByCode,
} from "./service";
import { onAttendeeEmailDelivered } from "../event-emails/service";
import { captainDetailsDelivered, captainInfo } from "./captain";
import { BUS_WAITLIST_DEFAULTS, notifyBusWaitlist, removeFromBusWaitlist, seatsFreed, syncBusWaitlist } from "./waitlist";

/**
 * Seats an edit gave back, per booking, until the edit's new reservation
 * runs: only the net change counts as "seats freed" (a guest who keeps
 * their bus while changing another answer frees nothing).
 */
const editReleases = new Map<string, Map<string, number>>();

/**
 * Bus transport: routes with seats, chosen in the registration form through
 * a select whose choices come from this module (`choicesSource:
 * "bus-transport:routes"`). Seats are reserved atomically with the
 * registration and released on cancel/expiry. Each bus has a captain link
 * for boarding (outbound and return, kept apart from venue check-in).
 */
export const BUS_TRANSPORT = "bus-transport";

export function registerBusTransportModule(): void {
  registerModule({
    key: BUS_TRANSPORT,
    name: "Bus transport",
    description: "Buses with seat limits chosen at registration, captain passenger lists and boarding (outbound / return).",
    scopes: ["org", "group", "event"],
    configFields: [
      {
        key: "transferRules",
        label: "Transfer rules (shown to guests)",
        type: "text",
        hint: "e.g. A busz az indulási időponthoz képest legfeljebb 15 percet vár. Available in emails as {{bus.rules}} and in the guest API.",
      },
      {
        key: "busWaitlistSubject",
        deprecated: "Deprecated: edit this email on the Emails page (system email “Bus waitlist: seat freed”). An email there overrides this field.",
        label: "Bus waitlist email subject (a seat freed up)",
        type: "text",
        hint: `Placeholders {{name}}, {{event}}, {{siteUrl}}. Default: ${BUS_WAITLIST_DEFAULTS.subject}`,
      },
      {
        key: "busWaitlistMessage",
        deprecated: "Deprecated: edit this email on the Emails page (system email “Bus waitlist: seat freed”). An email there overrides this field.",
        label: "Bus waitlist email text",
        type: "text",
        hint: "Sent to guests who asked to be notified (bus answer “waitlist”). Placeholders {{name}}, {{event}}, {{siteUrl}}. Empty = the built-in Hungarian text.",
      },
    ],
  });

  extensions.registerChoiceProvider({
    key: BUS_ROUTES_SOURCE,
    moduleKey: BUS_TRANSPORT,
    label: "Buses (Bus transport)",
    // No active bus yet ("bus booking not open"): the bus question offers nothing and may be left empty.
    optionalWhenEmpty: true,
    async list(ctx) {
      const routes = (await listRoutes(String(ctx.event._id))).filter((route) => route.active);
      // Without buses there is nothing to wait for either: no "notify me" option, so "waitlist" is refused like any unknown answer.
      if (routes.length === 0) return [];
      // One choice per stop of a multi-stop bus ("<routeId>~<stop index>"), all sharing the bus's seats.
      const choices = routes.flatMap((route) => routeChoices(route));
      // Always offered: no seat, the guest waits for one and is emailed when one frees up.
      return [...choices, { value: BUS_WAITLIST_VALUE, label: BUS_WAITLIST_LABEL, remaining: null, disabled: false, meta: { waitlist: true } }];
    },
  });

  // An email carrying the captain's details marks its guest "informed" about that bus's captain.
  onAttendeeEmailDelivered(captainDetailsDelivered);

  extensions.registerRegistrationReserver(BUS_TRANSPORT, async (ctx) => {
    if (!ctx.modules.isOn(BUS_TRANSPORT)) return null;
    if (busRouteFields(ctx.fieldSchema).length === 0) return null;
    const eventId = String(ctx.event._id);
    const wanted = seatsByRoute(ctx.attendees, ctx.fieldSchema);
    if (ctx.dryRun) return reserveSeats(eventId, wanted, { dryRun: true });
    if (ctx.isTest) {
      // Test registrations take no seats (live availability is untouched); the bus waitlist still works, in its own line.
      await syncBusWaitlist({ organizationId: ctx.organizationId, eventId }, ctx.bookingId, ctx.attendees, ctx.fieldSchema);
      return null;
    }
    const reservation = await reserveSeats(eventId, wanted);
    await syncBusWaitlist({ organizationId: ctx.organizationId, eventId }, ctx.bookingId, ctx.attendees, ctx.fieldSchema);
    const released = editReleases.get(ctx.bookingId);
    if (released) {
      editReleases.delete(ctx.bookingId);
      if ([...released].some(([routeId, count]) => count > (wanted.get(routeId) ?? 0))) await seatsFreed(eventId);
    }
    return reservation;
  });

  // Seats are released whether or not the module is still on: they were taken while it was.
  extensions.onBookingReleased(BUS_TRANSPORT, async (booking, reason) => {
    if (booking.isTest) {
      if (reason === "edited") return;
      await removeFromBusWaitlist(booking);
      // A cancelled test guest who had a bus "frees" a seat for the test line only (no live seat changes).
      const hadBus = seatsByRoute((booking.attendees ?? []) as never, booking.attendeeFieldSchema as never).size > 0;
      if (hadBus && (reason === "cancelled" || reason === "attendee_cancelled")) await notifyBusWaitlist(String(booking.eventId), new Date(), { test: true });
      return;
    }
    const released = await releaseSeatsForBooking(booking);
    if (reason === "edited") {
      // The edit reserves its new answers next; decide there whether seats were really freed.
      if (released.size > 0) editReleases.set(String(booking._id), released);
      return;
    }
    await removeFromBusWaitlist(booking);
    if (released.size > 0) await seatsFreed(String(booking.eventId));
  });

  extensions.registerAttendeePlaceholders({
    moduleKey: BUS_TRANSPORT,
    placeholders: [
      {
        key: "bus.transfer",
        label: "Transfer (Foglalt / Várólistán (értesítünk) / Igényelt (járat még nincs kiválasztva) / Nem igényelt)",
        sample: "Foglalt",
      },
      { key: "bus.city", label: "Bus: departure city (the guest's stop)", sample: "Szeged" },
      { key: "bus.pickupPoint", label: "Bus: pickup point (the guest's stop)", sample: "Mars tér, buszpályaudvar" },
      { key: "bus.code", label: "Bus: identifier", sample: "B03" },
      { key: "bus.routeName", label: "Bus: route name (e.g. Szombathely–Győr–Tatabánya)", sample: "Szeged" },
      { key: "bus.departure", label: "Bus: departure date and time (the guest's stop)", sample: "2026. december 4. 15:30" },
      { key: "bus.returnInfo", label: "Bus: return trip", sample: "00:00–02:00 között, a csoport igényeihez igazodva" },
      { key: "bus.captainName", label: "Bus: captain's name", sample: "Kapitány Kázmér" },
      { key: "bus.captainPhone", label: "Bus: captain's phone", sample: "+36 30 123 4567" },
      {
        key: "bus.captainInfo",
        label: "Bus: captain's name and phone (two lines), or “we'll tell you later” while the bus has no captain",
        sample: "Buszkapitány neve: Kapitány Kázmér\nBuszkapitány telefonszáma: +36 30 123 4567",
      },
      { key: "bus.rules", label: "Bus: transfer rules (module setting)", sample: "A busz legfeljebb 15 percet vár." },
    ],
    async values(ctx, booking, attendeeIndex) {
      const bus = await busForAttendee(booking, attendeeIndex);
      const route = bus?.route ?? null;
      const rules = route ? (ctx.modules.config<{ transferRules?: string }>(BUS_TRANSPORT).transferRules ?? "") : "";
      if (!route) {
        return {
          "bus.transfer": attendeeOnBusWaitlist(booking, attendeeIndex)
            ? "Várólistán (értesítünk)"
            : attendeeAwaitsBus(booking, attendeeIndex)
              ? "Igényelt (járat még nincs kiválasztva)"
              : "Nem igényelt",
          "bus.city": "",
          "bus.pickupPoint": "",
          "bus.code": "",
          "bus.routeName": "",
          "bus.departure": "",
          "bus.returnInfo": "",
          "bus.captainName": "",
          "bus.captainPhone": "",
          "bus.captainInfo": "",
          "bus.rules": "",
        };
      }
      return {
        "bus.transfer": "Foglalt",
        "bus.city": bus!.stop.city,
        "bus.pickupPoint": bus!.stop.pickupPoint,
        "bus.code": route.code,
        "bus.routeName": route.city,
        "bus.departure": formatDeparture(bus!.stop.departureAt),
        "bus.returnInfo": route.returnInfo,
        "bus.captainName": route.captainName,
        "bus.captainPhone": route.captainPhone,
        "bus.captainInfo": captainInfo(route),
        "bus.rules": rules,
      };
    },
  });

  registerImportTarget({
    key: "bus-transport:routes",
    label: "Buses",
    description: "Create or update the event's buses from a sheet. Rows are matched to existing buses by identifier.",
    moduleKey: BUS_TRANSPORT,
    needsEvent: true,
    fields: [
      { key: "code", label: "Bus identifier", required: true, hint: "e.g. B01 — unique within the event" },
      { key: "city", label: "Departure city", required: true },
      { key: "pickupPoint", label: "Pickup point (address)" },
      { key: "departureAt", label: "Departure (date and time)", hint: "2026-12-04 15:30, or a time like 15:30 on the event day" },
      { key: "capacity", label: "Seats", required: true },
      { key: "captainName", label: "Captain's name" },
      { key: "captainPhone", label: "Captain's phone" },
      { key: "returnInfo", label: "Return trip note" },
    ],
    async apply(ctx, rows) {
      const event = await eventRepository.findById(ctx.eventId!);
      if (!event) throw new Error("Event not found");
      const parsed = rows.map((row) => ({
        code: row.code ?? "",
        city: row.city ?? "",
        pickupPoint: row.pickupPoint,
        departureAt: parseDeparture(row.departureAt, event.startDate),
        capacity: Number.parseInt(String(row.capacity ?? "").replace(/\D+/g, ""), 10),
        captainName: row.captainName,
        captainPhone: row.captainPhone,
        returnInfo: row.returnInfo,
      }));
      const valid = parsed.filter((row) => row.code.trim() && row.city.trim());
      const result = await upsertRoutesByCode(ctx.organizationId, ctx.eventId!, valid);
      return {
        message: `${result.created} buses created, ${result.updated} updated.`,
        created: result.created,
        updated: result.updated,
        skipped: parsed.length - valid.length,
        errors: result.errors,
      };
    },
  });
}

/**
 * Reads a departure cell: a full date-time, or just "HH:mm" taken on the
 * event's start day. Times are Budapest local time.
 */
export function parseDeparture(raw: string | undefined, eventStart: Date): Date | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const timeOnly = /^(\d{1,2})[:.](\d{2})$/.exec(text);
  const dateTime = /^(\d{4})[-./ ]+(\d{1,2})[-./ ]+(\d{1,2})\.?(?:[ T]+(\d{1,2})[:.](\d{2}))?/.exec(text);
  let y: number, m: number, d: number, hh: number, mm: number;
  if (timeOnly) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" }).format(eventStart);
    [y, m, d] = day.split("-").map(Number) as [number, number, number];
    hh = Number(timeOnly[1]);
    mm = Number(timeOnly[2]);
  } else if (dateTime) {
    y = Number(dateTime[1]);
    m = Number(dateTime[2]);
    d = Number(dateTime[3]);
    hh = Number(dateTime[4] ?? 0);
    mm = Number(dateTime[5] ?? 0);
  } else {
    return null;
  }
  return budapestToUtc(y, m, d, hh, mm);
}

/** Wall-clock time in Budapest → the UTC instant (handles CET/CEST). */
export function budapestToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Budapest", hour: "2-digit", minute: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(guess);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess.getTime() - (shown - guess.getTime()));
}

export * from "./service";
export * from "./model";
export * from "./waitlist";
export * from "./captain";
