import { createHash, randomBytes } from "node:crypto";
import ExcelJS from "exceljs";
import { Types } from "mongoose";
import { ActionError } from "@tbook/actions";
import { BookingModel, type IBooking } from "@tbook/db";
import type { AttendeeFieldDef, BookingAttendee } from "@tbook/schemas";
import { ACTIVE_BOOKING_STATUSES, toEventAttendees, type EventAttendee } from "../shared/attendees";
import { BusBoardingModel, BusRouteModel, type BoardingStatus, type BusLeg, type IBusRoute } from "./model";
import { notifyBusWaitlist, seatsFreed, type BusWaitlistRow } from "./waitlist";

/** The `choicesSource` that turns a select field into "pick your bus". */
export const BUS_ROUTES_SOURCE = "bus-transport:routes";

/** The extra bus answer "no free seat — notify me": holds no seat, puts the guest on the bus waitlist. */
export const BUS_WAITLIST_VALUE = "waitlist";
export const BUS_WAITLIST_LABEL = "Nincs szabad hely – értesítést kérek, ha felszabadul";

export function isBusWaitlistValue(value: unknown): boolean {
  return String(value ?? "") === BUS_WAITLIST_VALUE;
}

const TIME_ZONE = "Europe/Budapest";

export function formatDeparture(date: Date | null | undefined): string {
  if (!date) return "";
  return new Intl.DateTimeFormat("hu-HU", { dateStyle: "long", timeStyle: "short", timeZone: TIME_ZONE }).format(date);
}

function formatTime(date: Date | null | undefined): string {
  if (!date) return "";
  return new Intl.DateTimeFormat("hu-HU", { timeStyle: "short", timeZone: TIME_ZONE }).format(date);
}

/** The label a guest picks from: "Szeged – Mars tér (B03), 15:30". */
export function routeLabel(route: Pick<IBusRoute, "city" | "pickupPoint" | "code" | "departureAt">): string {
  const place = [route.city, route.pickupPoint].filter(Boolean).join(" – ");
  const time = formatTime(route.departureAt);
  return `${place} (${route.code})${time ? `, ${time}` : ""}`;
}

export function busRouteFields(schema: AttendeeFieldDef[] | undefined | null): AttendeeFieldDef[] {
  return (schema ?? []).filter((field) => field.type === "select" && field.choicesSource === BUS_ROUTES_SOURCE);
}

/** routeId → number of seats this booking's attendees ask for. */
export function seatsByRoute(attendees: BookingAttendee[], schema: AttendeeFieldDef[] | undefined | null): Map<string, number> {
  const counts = new Map<string, number>();
  const fields = busRouteFields(schema);
  for (const attendee of attendees) {
    for (const field of fields) {
      const value = attendee.fields?.[field.key];
      if (value == null || value === "" || isBusWaitlistValue(value)) continue;
      const routeId = String(value);
      counts.set(routeId, (counts.get(routeId) ?? 0) + 1);
    }
  }
  return counts;
}

// ---- Routes (admin) ------------------------------------------------------------

export interface BusRouteInput {
  code: string;
  city: string;
  pickupPoint?: string;
  departureAt?: Date | null;
  returnInfo?: string;
  capacity: number;
  captainName?: string;
  captainPhone?: string;
  notes?: string;
  active?: boolean;
  sortOrder?: number;
}

export function listRoutes(eventId: string): Promise<IBusRoute[]> {
  return BusRouteModel.find({ eventId }).sort({ sortOrder: 1, city: 1, code: 1 }).exec();
}

export async function getRouteForOrg(organizationId: string, routeId: string): Promise<IBusRoute> {
  const route = Types.ObjectId.isValid(routeId) ? await BusRouteModel.findById(routeId).exec() : null;
  if (!route || String(route.organizationId) !== organizationId) throw ActionError.notFound("Bus not found");
  return route;
}

function cleanInput(input: BusRouteInput) {
  const code = input.code.trim();
  const city = input.city.trim();
  if (!code) throw ActionError.validation("Give the bus an identifier (e.g. B01).");
  if (!city) throw ActionError.validation("Give the departure city.");
  if (!Number.isInteger(input.capacity) || input.capacity < 0) throw ActionError.validation("Seats must be a whole number.");
  return {
    code,
    city,
    pickupPoint: input.pickupPoint?.trim() ?? "",
    departureAt: input.departureAt ?? null,
    returnInfo: input.returnInfo?.trim() ?? "",
    capacity: input.capacity,
    captainName: input.captainName?.trim() ?? "",
    captainPhone: input.captainPhone?.trim() ?? "",
    notes: input.notes?.trim() ?? "",
    active: input.active ?? true,
    sortOrder: input.sortOrder ?? 0,
  };
}

export async function createRoute(organizationId: string, eventId: string, input: BusRouteInput): Promise<IBusRoute> {
  try {
    const route = await BusRouteModel.create({ organizationId, eventId, ...cleanInput(input), seatsTaken: 0 });
    if (route.active && route.capacity > 0) await seatsFreed(eventId);
    return route;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw ActionError.validation(`A bus with identifier "${input.code.trim()}" already exists for this event.`);
    throw error;
  }
}

export async function updateRoute(organizationId: string, routeId: string, input: BusRouteInput): Promise<IBusRoute> {
  const route = await getRouteForOrg(organizationId, routeId);
  const clean = cleanInput(input);
  if (clean.capacity < route.seatsTaken) {
    throw ActionError.validation(`${route.seatsTaken} seats are already booked on this bus; capacity can't go below that.`);
  }
  try {
    const updated = await BusRouteModel.findByIdAndUpdate(routeId, clean, { returnDocument: "after" }).exec();
    const freeBefore = route.active ? route.capacity - route.seatsTaken : 0;
    const freeAfter = updated!.active ? updated!.capacity - updated!.seatsTaken : 0;
    if (freeAfter > freeBefore) await seatsFreed(String(route.eventId));
    return updated!;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw ActionError.validation(`A bus with identifier "${clean.code}" already exists for this event.`);
    throw error;
  }
}

export async function deleteRoute(organizationId: string, routeId: string): Promise<void> {
  const route = await getRouteForOrg(organizationId, routeId);
  if (route.seatsTaken > 0) throw ActionError.validation("Guests are booked on this bus. Move them or switch the bus off instead.");
  await BusRouteModel.deleteOne({ _id: routeId }).exec();
  await BusBoardingModel.deleteMany({ routeId }).exec();
}

/**
 * Upserts routes by identifier from a spreadsheet import. Existing buses
 * keep their booked seats and captain link; only the listed details change.
 */
export async function upsertRoutesByCode(
  organizationId: string,
  eventId: string,
  rows: BusRouteInput[],
): Promise<{ created: number; updated: number; errors: string[] }> {
  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  for (const [index, row] of rows.entries()) {
    try {
      const existing = await BusRouteModel.findOne({ eventId, code: row.code.trim() }).exec();
      if (existing) {
        await updateRoute(organizationId, String(existing._id), { ...row, sortOrder: row.sortOrder ?? existing.sortOrder });
        updated += 1;
      } else {
        await createRoute(organizationId, eventId, { ...row, sortOrder: row.sortOrder ?? index });
        created += 1;
      }
    } catch (error) {
      errors.push(`Row ${index + 2}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { created, updated, errors };
}

// ---- Seats ----------------------------------------------------------------------

/** The error a full bus raises (its code lets the waitlist fall back to the bus waitlist). */
export function busFullError(route: Pick<IBusRoute, "city" | "code">, routeId: string): ActionError {
  return new ActionError(400, "bus_full", `A(z) ${route.city} (${route.code}) busz megtelt. Válassz másik járatot, vagy kérj értesítést, ha felszabadul hely.`, { routeId });
}

/** Atomically takes seats on each route, all or nothing. `dryRun` only checks (preview mode). */
export async function reserveSeats(eventId: string, wanted: Map<string, number>, opts: { dryRun?: boolean } = {}): Promise<{ release: () => Promise<void> } | null> {
  if (wanted.size === 0) return null;
  if (opts.dryRun) {
    for (const [routeId, count] of wanted) {
      const route = Types.ObjectId.isValid(routeId) ? await BusRouteModel.findOne({ _id: routeId, eventId }).exec() : null;
      if (!route || !route.active) throw ActionError.validation("A választott busz nem elérhető. Válassz másikat.");
      if (route.seatsTaken + count > route.capacity) throw busFullError(route, routeId);
    }
    return null;
  }
  const taken: Array<[string, number]> = [];
  const release = async () => {
    for (const [routeId, count] of taken) await BusRouteModel.updateOne({ _id: routeId }, { $inc: { seatsTaken: -count } }).exec();
  };
  for (const [routeId, count] of wanted) {
    const route = Types.ObjectId.isValid(routeId) ? await BusRouteModel.findOne({ _id: routeId, eventId }).exec() : null;
    if (!route || !route.active) {
      await release();
      throw ActionError.validation("A választott busz nem elérhető. Válassz másikat.");
    }
    const result = await BusRouteModel.updateOne(
      { _id: routeId, eventId, active: true, $expr: { $lte: [{ $add: ["$seatsTaken", count] }, "$capacity"] } },
      { $inc: { seatsTaken: count } },
    ).exec();
    if (result.modifiedCount !== 1) {
      await release();
      throw busFullError(route, routeId);
    }
    taken.push([routeId, count]);
  }
  return { release };
}

/** Gives a booking's seats back; returns routeId → seats released. */
export async function releaseSeatsForBooking(booking: IBooking): Promise<Map<string, number>> {
  const wanted = seatsByRoute((booking.attendees ?? []) as BookingAttendee[], booking.attendeeFieldSchema as AttendeeFieldDef[]);
  for (const [routeId, count] of wanted) {
    if (!Types.ObjectId.isValid(routeId)) continue;
    const result = await BusRouteModel.updateOne({ _id: routeId, eventId: booking.eventId, seatsTaken: { $gte: count } }, { $inc: { seatsTaken: -count } }).exec();
    // Never below zero (a recount may already have corrected it).
    if (result.modifiedCount === 0) await BusRouteModel.updateOne({ _id: routeId, eventId: booking.eventId }, { seatsTaken: 0 }).exec();
  }
  return wanted;
}

/**
 * Recomputes every route's booked seats from the active registrations — the
 * safety net after an organizer edits someone's bus by hand.
 */
export async function recountSeats(organizationId: string, eventId: string): Promise<number> {
  const routes = await listRoutes(eventId);
  const counts = new Map<string, number>();
  const bookings = await BookingModel.find({ eventId, status: { $in: [...ACTIVE_BOOKING_STATUSES, "pending", "checkout_started"] } }).exec();
  for (const booking of bookings) {
    for (const [routeId, count] of seatsByRoute((booking.attendees ?? []) as BookingAttendee[], booking.attendeeFieldSchema as AttendeeFieldDef[])) {
      counts.set(routeId, (counts.get(routeId) ?? 0) + count);
    }
  }
  let freed = false;
  for (const route of routes) {
    if (String(route.organizationId) !== organizationId) continue;
    const next = counts.get(String(route._id)) ?? 0;
    if (next < route.seatsTaken) freed = true;
    await BusRouteModel.updateOne({ _id: route._id }, { seatsTaken: next }).exec();
  }
  if (freed) await seatsFreed(eventId);
  else await notifyBusWaitlist(eventId);
  return routes.length;
}

// ---- Passengers & boarding --------------------------------------------------------

export interface Passenger {
  attendeeKey: string;
  bookingId: string;
  attendeeIndex: number;
  name: string;
  registrationNumber: string | null;
  phone: string;
  email: string;
  outbound: BoardingStatus | null;
  return: BoardingStatus | null;
}

function phoneOf(row: EventAttendee): string {
  const phoneField = ((row.booking.attendeeFieldSchema ?? []) as AttendeeFieldDef[]).find((field) => field.type === "phone");
  const own = phoneField ? row.fields[phoneField.key] : undefined;
  return String(own ?? row.booking.customer?.phone ?? "");
}

function emailOf(row: EventAttendee): string {
  const emailField = ((row.booking.attendeeFieldSchema ?? []) as AttendeeFieldDef[]).find((field) => field.type === "email");
  const own = emailField ? row.fields[emailField.key] : undefined;
  return String(own ?? row.booking.customer?.email ?? "");
}

/** Who is booked on a route, with each leg's boarding status. */
export async function listPassengers(route: IBusRoute): Promise<Passenger[]> {
  const bookings = await BookingModel.find({ eventId: route.eventId, status: { $in: ACTIVE_BOOKING_STATUSES } }).sort({ createdAt: 1 }).exec();
  const routeId = String(route._id);
  const rows: EventAttendee[] = [];
  for (const booking of bookings) {
    const fields = busRouteFields(booking.attendeeFieldSchema as AttendeeFieldDef[]);
    if (fields.length === 0) continue;
    for (const row of toEventAttendees(booking)) {
      if (fields.some((field) => String(row.fields[field.key] ?? "") === routeId)) rows.push(row);
    }
  }
  const boardings = await BusBoardingModel.find({ routeId: route._id }).lean().exec();
  const status = new Map(boardings.map((b) => [`${b.attendeeKey}\u0000${b.leg}`, b.status as BoardingStatus]));
  return rows
    .map((row) => ({
      attendeeKey: row.attendeeKey,
      bookingId: String(row.booking._id),
      attendeeIndex: row.index,
      name: row.displayName,
      registrationNumber: row.registrationNumber,
      phone: phoneOf(row),
      email: emailOf(row),
      outbound: status.get(`${row.attendeeKey}\u0000outbound`) ?? null,
      return: status.get(`${row.attendeeKey}\u0000return`) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "hu"));
}

export interface LegCounts {
  booked: number;
  boarded: number;
  notBoarded: number;
  /** Not yet marked either way. */
  missing: number;
}

export function legCounts(passengers: Passenger[], leg: BusLeg): LegCounts {
  const boarded = passengers.filter((p) => p[leg] === "boarded").length;
  const notBoarded = passengers.filter((p) => p[leg] === "not_boarded").length;
  return { booked: passengers.length, boarded, notBoarded, missing: passengers.length - boarded - notBoarded };
}

/**
 * Marks one passenger boarded / not boarded on one leg (null clears it).
 * The passenger must be booked on this route — a captain link can't touch
 * anyone else's record.
 */
export async function setBoarding(
  route: IBusRoute,
  attendeeKey: string,
  leg: BusLeg,
  status: BoardingStatus | null,
  markedBy: string,
): Promise<void> {
  const passengers = await listPassengers(route);
  const passenger = passengers.find((p) => p.attendeeKey === attendeeKey);
  if (!passenger) throw ActionError.notFound("This guest isn't booked on this bus.");
  if (status === null) {
    await BusBoardingModel.deleteOne({ eventId: route.eventId, attendeeKey, leg }).exec();
    return;
  }
  await BusBoardingModel.updateOne(
    { eventId: route.eventId, attendeeKey, leg },
    {
      $set: {
        organizationId: route.organizationId,
        routeId: route._id,
        bookingId: new Types.ObjectId(passenger.bookingId),
        status,
        markedBy,
        markedAt: new Date(),
      },
    },
    { upsert: true },
  ).exec();
}

// ---- Captain links ----------------------------------------------------------------

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates (or replaces) a route's captain link token. The plain token is returned once. */
export async function rotateCaptainToken(organizationId: string, routeId: string): Promise<string> {
  await getRouteForOrg(organizationId, routeId);
  const token = randomBytes(24).toString("base64url");
  await BusRouteModel.updateOne({ _id: routeId }, { captainTokenHash: hashToken(token), captainTokenHint: token.slice(-4) }).exec();
  return token;
}

export async function revokeCaptainToken(organizationId: string, routeId: string): Promise<void> {
  await getRouteForOrg(organizationId, routeId);
  await BusRouteModel.updateOne({ _id: routeId }, { captainTokenHash: null, captainTokenHint: "" }).exec();
}

/** Resolves a captain link to its route; null for an unknown or revoked token. */
export async function findRouteByCaptainToken(token: string): Promise<IBusRoute | null> {
  if (!token || token.length < 20) return null;
  return BusRouteModel.findOne({ captainTokenHash: hashToken(token) }).exec();
}

// ---- Guest-facing details -----------------------------------------------------------

/** True when the attendee chose "értesítést kérek" (bus waitlist) for a bus question. */
export function attendeeOnBusWaitlist(booking: Pick<IBooking, "attendees" | "attendeeFieldSchema">, attendeeIndex: number): boolean {
  const attendee = ((booking.attendees ?? []) as BookingAttendee[])[attendeeIndex];
  return busRouteFields(booking.attendeeFieldSchema as AttendeeFieldDef[]).some((field) => isBusWaitlistValue(attendee?.fields?.[field.key]));
}

export async function routeForAttendee(booking: IBooking, attendeeIndex: number): Promise<IBusRoute | null> {
  const attendee = ((booking.attendees ?? []) as BookingAttendee[])[attendeeIndex];
  for (const field of busRouteFields(booking.attendeeFieldSchema as AttendeeFieldDef[])) {
    const value = attendee?.fields?.[field.key];
    if (value && Types.ObjectId.isValid(String(value))) {
      const route = await BusRouteModel.findOne({ _id: String(value), eventId: booking.eventId }).exec();
      if (route) return route;
    }
  }
  return null;
}

// ---- Export ---------------------------------------------------------------------------

const STATUS_LABELS: Record<BoardingStatus, string> = { boarded: "Felszállt", not_boarded: "Nem szállt fel" };

/**
 * One sheet per bus: passenger list with both legs' boarding status. With
 * `waitlist`, a last sheet lists the bus waitlist (they are not passengers).
 */
export async function exportPassengersXlsx(routes: IBusRoute[], waitlist?: BusWaitlistRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet("Összesítő");
  summary.columns = [
    { header: "Busz", key: "code", width: 10 },
    { header: "Város", key: "city", width: 18 },
    { header: "Felszállási hely", key: "pickup", width: 30 },
    { header: "Indulás", key: "departure", width: 22 },
    { header: "Férőhely", key: "capacity", width: 10 },
    { header: "Foglalt", key: "booked", width: 10 },
    { header: "Oda: felszállt", key: "outBoarded", width: 14 },
    { header: "Vissza: felszállt", key: "retBoarded", width: 16 },
    { header: "Buszkapitány", key: "captain", width: 22 },
    { header: "Telefon", key: "phone", width: 16 },
  ];
  for (const route of routes) {
    const passengers = await listPassengers(route);
    summary.addRow({
      code: route.code,
      city: route.city,
      pickup: route.pickupPoint,
      departure: formatDeparture(route.departureAt),
      capacity: route.capacity,
      booked: passengers.length,
      outBoarded: legCounts(passengers, "outbound").boarded,
      retBoarded: legCounts(passengers, "return").boarded,
      captain: route.captainName,
      phone: route.captainPhone,
    });
    const sheet = workbook.addWorksheet(route.code.replace(/[\\/?*[\]:]/g, "-").slice(0, 31) || "Busz");
    sheet.columns = [
      { header: "Név", key: "name", width: 28 },
      { header: "Regisztrációs azonosító", key: "reg", width: 22 },
      { header: "Telefon", key: "phone", width: 16 },
      { header: "E-mail", key: "email", width: 28 },
      { header: "Oda", key: "outbound", width: 16 },
      { header: "Vissza", key: "return", width: 16 },
    ];
    for (const passenger of passengers) {
      sheet.addRow({
        name: passenger.name,
        reg: passenger.registrationNumber ?? "",
        phone: passenger.phone,
        email: passenger.email,
        outbound: passenger.outbound ? STATUS_LABELS[passenger.outbound] : "",
        return: passenger.return ? STATUS_LABELS[passenger.return] : "",
      });
    }
    sheet.getRow(1).font = { bold: true };
  }
  summary.getRow(1).font = { bold: true };
  if (waitlist && waitlist.length > 0) {
    const sheet = workbook.addWorksheet("Busz-várólista");
    sheet.columns = [
      { header: "Sorszám", key: "position", width: 10 },
      { header: "Név", key: "name", width: 28 },
      { header: "Regisztrációs azonosító", key: "reg", width: 22 },
      { header: "Telefon", key: "phone", width: 16 },
      { header: "E-mail", key: "email", width: 28 },
      { header: "Várólistára került", key: "joined", width: 22 },
      { header: "Utolsó értesítés", key: "notified", width: 22 },
    ];
    for (const row of waitlist) {
      sheet.addRow({ position: row.position, name: row.name, reg: row.registrationNumber ?? "", phone: row.phone, email: row.email, joined: formatDeparture(row.joinedAt), notified: formatDeparture(row.notifiedAt) });
    }
    sheet.getRow(1).font = { bold: true };
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
