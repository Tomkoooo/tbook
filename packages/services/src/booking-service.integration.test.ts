import { MongoMemoryServer } from "mongodb-memory-server";
import { BookingModel, EventModel, HotelModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { ActionError } from "@tbook/actions";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPendingBooking, expireBooking, quote } from "./booking-service";

function baseCustomer() {
  return { name: "Kovács Anna", email: "anna@example.com", phone: "+36301234567", note: "" };
}

async function createEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return EventModel.create({
    name: "Első WDF verseny",
    status: "active",
    startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    endDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    ticketFeeHuf: 5000,
    ticketFeeMode: "per_person",
    ticketPriceBasis: "gross",
    ticketVatPercent: 27,
    ...overrides,
  });
}

describe("booking-service", () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
  });

  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });

  beforeEach(async () => {
    await Promise.all([EventModel.deleteMany({}), HotelModel.deleteMany({}), BookingModel.deleteMany({})]);
  });

  it("quotes a ticket-only booking using the server-side pricing engine", async () => {
    const event = await createEvent();
    const ctx = await quote({ eventId: String(event._id), guests: 2 });
    expect(ctx.quote.totalHuf).toBe(10_000); // 2 × 5000 gross, no VAT re-application (already gross)
    expect(ctx.quote.lines[0]?.key).toBe("ticket");
  });

  it("rejects a quote for an event outside its sales window", async () => {
    const event = await createEvent({ salesClosesAt: new Date(Date.now() - 60_000) });
    await expect(quote({ eventId: String(event._id), guests: 1 })).rejects.toMatchObject({ code: "validation_error" });
  });

  it("creates a pending booking with a server-recomputed quote", async () => {
    const event = await createEvent();
    const booking = await createPendingBooking({
      eventId: String(event._id),
      guests: 2,
      customer: baseCustomer(),
    });
    expect(booking.status).toBe("pending");
    expect(booking.totalHuf).toBe(10_000);
    expect(booking.eventName).toBe(event.name);
  });

  it("reserves event capacity atomically and rejects once exhausted", async () => {
    const event = await createEvent({ capacity: 3 });

    const first = await createPendingBooking({ eventId: String(event._id), guests: 2, customer: baseCustomer() });
    expect(first.status).toBe("pending");

    await expect(createPendingBooking({ eventId: String(event._id), guests: 2, customer: baseCustomer() })).rejects.toMatchObject({
      code: "validation_error",
    });

    const reloaded = await EventModel.findById(event._id).exec();
    expect(reloaded?.soldGuestCount).toBe(2); // failed attempt must not have left a partial reservation
  });

  it("rolls back the capacity reservation when a later validation step fails", async () => {
    const event = await createEvent({
      capacity: 5,
      registrationUnit: "person",
      attendeeFieldSchema: [{ key: "email", label: "Email", type: "email", required: true, sortOrder: 0 }],
    });

    await expect(
      createPendingBooking({
        eventId: String(event._id),
        guests: 1,
        customer: baseCustomer(),
        attendees: [{ fields: { email: "not-an-email" } }],
      }),
    ).rejects.toMatchObject({ code: "validation_error" });

    const reloaded = await EventModel.findById(event._id).exec();
    expect(reloaded?.soldGuestCount).toBe(0); // reservation was released after the attendee-validation failure
  });

  it("fires N concurrent bookings against limited capacity and admits exactly the ones that fit", async () => {
    const event = await createEvent({ capacity: 5 });

    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () => createPendingBooking({ eventId: String(event._id), guests: 1, customer: baseCustomer() })),
    );

    const succeeded = attempts.filter((r) => r.status === "fulfilled");
    const failed = attempts.filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(5);
    expect(failed).toHaveLength(5);
    for (const failure of failed) {
      expect((failure as PromiseRejectedResult).reason).toBeInstanceOf(ActionError);
    }

    const reloaded = await EventModel.findById(event._id).exec();
    expect(reloaded?.soldGuestCount).toBe(5); // never oversold despite 10 concurrent attempts

    const persistedBookings = await BookingModel.countDocuments({ eventId: event._id });
    expect(persistedBookings).toBe(5); // one booking row per successful reservation, no orphans
  });

  it("expireBooking releases the reservation and is idempotent", async () => {
    const event = await createEvent({ capacity: 3 });
    const booking = await createPendingBooking({ eventId: String(event._id), guests: 2, customer: baseCustomer() });

    const expired = await expireBooking(String(booking._id));
    expect(expired?.status).toBe("expired");

    const reloaded = await EventModel.findById(event._id).exec();
    expect(reloaded?.soldGuestCount).toBe(0);

    // Calling it again must no-op, not throw or double-release.
    const secondCall = await expireBooking(String(booking._id));
    expect(secondCall?.status).toBe("expired");
    const stillZero = await EventModel.findById(event._id).exec();
    expect(stillZero?.soldGuestCount).toBe(0);
  });

  it("expireBooking is a no-op for a booking that already progressed past pending/checkout_started", async () => {
    const event = await createEvent({ capacity: 3 });
    const booking = await createPendingBooking({ eventId: String(event._id), guests: 1, customer: baseCustomer() });
    await BookingModel.findByIdAndUpdate(booking._id, { status: "paid" }).exec();

    const result = await expireBooking(String(booking._id));
    expect(result?.status).toBe("paid"); // untouched, not force-expired
  });
});
