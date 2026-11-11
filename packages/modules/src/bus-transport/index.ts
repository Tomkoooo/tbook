import { eventRepository } from "@tbook/db";
import { extensions, registerImportTarget, registerModule } from "@tbook/services";
import {
  BUS_ROUTES_SOURCE,
  busRouteFields,
  formatDeparture,
  listRoutes,
  releaseSeatsForBooking,
  reserveSeats,
  routeForAttendee,
  routeLabel,
  seatsByRoute,
  upsertRoutesByCode,
} from "./service";

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
    ],
  });

  extensions.registerChoiceProvider({
    key: BUS_ROUTES_SOURCE,
    moduleKey: BUS_TRANSPORT,
    label: "Buses (Bus transport)",
    async list(ctx) {
      const routes = await listRoutes(String(ctx.event._id));
      return routes
        .filter((route) => route.active)
        .map((route) => {
          const remaining = Math.max(route.capacity - route.seatsTaken, 0);
          return {
            value: String(route._id),
            label: routeLabel(route),
            remaining,
            disabled: remaining <= 0,
            // Display details only; the captain's phone goes to booked guests by email, not to the public.
            meta: {
              code: route.code,
              city: route.city,
              pickupPoint: route.pickupPoint,
              departureAt: route.departureAt ? route.departureAt.toISOString() : null,
              departure: formatDeparture(route.departureAt),
              returnInfo: route.returnInfo,
            },
          };
        });
    },
  });

  extensions.registerRegistrationReserver(BUS_TRANSPORT, async (ctx) => {
    if (!ctx.modules.isOn(BUS_TRANSPORT)) return null;
    if (busRouteFields(ctx.fieldSchema).length === 0) return null;
    return reserveSeats(String(ctx.event._id), seatsByRoute(ctx.attendees, ctx.fieldSchema));
  });

  // Seats are released whether or not the module is still on: they were taken while it was.
  extensions.onBookingReleased(BUS_TRANSPORT, async (booking) => releaseSeatsForBooking(booking));

  extensions.registerAttendeePlaceholders({
    moduleKey: BUS_TRANSPORT,
    placeholders: [
      { key: "bus.transfer", label: "Transfer (Igényelt / Nem igényelt)", sample: "Igényelt" },
      { key: "bus.city", label: "Bus: departure city", sample: "Szeged" },
      { key: "bus.pickupPoint", label: "Bus: pickup point", sample: "Mars tér, buszpályaudvar" },
      { key: "bus.code", label: "Bus: identifier", sample: "B03" },
      { key: "bus.departure", label: "Bus: departure date and time", sample: "2026. december 4. 15:30" },
      { key: "bus.returnInfo", label: "Bus: return trip", sample: "00:00–02:00 között, a csoport igényeihez igazodva" },
      { key: "bus.captainName", label: "Bus: captain's name", sample: "Kovács Péter" },
      { key: "bus.captainPhone", label: "Bus: captain's phone", sample: "+36 30 123 4567" },
      { key: "bus.rules", label: "Bus: transfer rules (module setting)", sample: "A busz legfeljebb 15 percet vár." },
    ],
    async values(ctx, booking, attendeeIndex) {
      const route = await routeForAttendee(booking, attendeeIndex);
      const rules = route ? (ctx.modules.config<{ transferRules?: string }>(BUS_TRANSPORT).transferRules ?? "") : "";
      if (!route) {
        return {
          "bus.transfer": "Nem igényelt",
          "bus.city": "",
          "bus.pickupPoint": "",
          "bus.code": "",
          "bus.departure": "",
          "bus.returnInfo": "",
          "bus.captainName": "",
          "bus.captainPhone": "",
          "bus.rules": "",
        };
      }
      return {
        "bus.transfer": "Igényelt",
        "bus.city": route.city,
        "bus.pickupPoint": route.pickupPoint,
        "bus.code": route.code,
        "bus.departure": formatDeparture(route.departureAt),
        "bus.returnInfo": route.returnInfo,
        "bus.captainName": route.captainName,
        "bus.captainPhone": route.captainPhone,
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
