import { MongoMemoryServer } from "mongodb-memory-server";
import { BookingModel, EventModel, VoucherModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AFTER_BOOKING_PAID_HOOKS, expireBookingFromStripeSession, finalizeBookingFromStripeSession, getCheckoutStatus, loadBookingForGuestCheckout, stripeCurrencyCode, toStripeUnitAmount } from "./checkout-service";

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
    vouchersEnabled: true,
    capacity: 10,
    ...overrides,
  });
}

async function createCheckoutStartedBooking(eventId: string, stripeSessionId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return BookingModel.create({
    eventId,
    eventName: "Első WDF verseny",
    groupName: "",
    hotelName: "",
    customer: { name: "Kovács Anna", email: "anna@example.com", phone: "+36301234567", note: "" },
    attendeeFieldSchema: [],
    guests: 2,
    nights: 0,
    playersPerTicket: 1,
    attendees: [{ fields: {} }, { fields: {} }],
    selections: {},
    quote: { guests: 2, accommodationGuests: 0, nights: 0, ticketSubtotalHuf: 10_000, accommodationBaseHuf: 0, accommodationOptionsHuf: 0, accommodationSubtotalHuf: 0, totalHuf: 10_000, lines: [] },
    totalHuf: 10_000,
    currency: "HUF",
    status: "checkout_started",
    stripeSessionId,
    ...overrides,
  });
}

function fakeStripeSession(id: string, bookingId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    payment_status: "paid" as const,
    metadata: { tBookBookingId: bookingId },
    client_reference_id: bookingId,
    ...overrides,
  };
}

describe("checkout-service currency helpers", () => {
  it("treats HUF as a zero-decimal currency", () => {
    expect(stripeCurrencyCode("HUF")).toBe("huf");
    expect(toStripeUnitAmount(5000, "HUF")).toBe(5000);
  });

  it("multiplies non-zero-decimal currencies by 100", () => {
    expect(toStripeUnitAmount(49.99, "EUR")).toBe(4999);
  });
});

describe("checkout-service webhook finalization", () => {
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
    await Promise.all([EventModel.deleteMany({}), BookingModel.deleteMany({}), VoucherModel.deleteMany({})]);
  });

  afterEach(() => {
    AFTER_BOOKING_PAID_HOOKS.length = 0;
  });

  it("marks the booking paid and issues vouchers on first finalization", async () => {
    const event = await createEvent();
    const booking = await createCheckoutStartedBooking(String(event._id), "cs_test_1");

    const returnedId = await finalizeBookingFromStripeSession(fakeStripeSession("cs_test_1", String(booking._id)));
    expect(returnedId).toBe(String(booking._id));

    const reloaded = await BookingModel.findById(booking._id).exec();
    expect(reloaded?.status).toBe("paid");
    expect(reloaded?.paidAt).toBeInstanceOf(Date);

    const vouchers = await VoucherModel.find({ bookingId: booking._id }).exec();
    expect(vouchers).toHaveLength(2);
  });

  it("is idempotent — a second finalization call for the same session is a safe no-op", async () => {
    const event = await createEvent();
    const booking = await createCheckoutStartedBooking(String(event._id), "cs_test_2");
    const session = fakeStripeSession("cs_test_2", String(booking._id));

    const first = await finalizeBookingFromStripeSession(session);
    const second = await finalizeBookingFromStripeSession(session);
    expect(first).toBe(String(booking._id));
    expect(second).toBeNull(); // already finalized — CAS filter rejected the second write

    const vouchers = await VoucherModel.find({ bookingId: booking._id }).exec();
    expect(vouchers).toHaveLength(2); // not duplicated by the second call
  });

  it("admits exactly one winner when the same session is finalized concurrently", async () => {
    const event = await createEvent();
    const booking = await createCheckoutStartedBooking(String(event._id), "cs_test_3");
    const session = fakeStripeSession("cs_test_3", String(booking._id));

    const results = await Promise.all(Array.from({ length: 5 }, () => finalizeBookingFromStripeSession(session)));
    expect(results.filter((r) => r !== null)).toHaveLength(1);

    const vouchers = await VoucherModel.find({ bookingId: booking._id }).exec();
    expect(vouchers).toHaveLength(2); // exactly one issuance, no duplicates from the losing racers
  });

  it("does nothing for a session that isn't paid", async () => {
    const event = await createEvent();
    const booking = await createCheckoutStartedBooking(String(event._id), "cs_test_4");

    const result = await finalizeBookingFromStripeSession(fakeStripeSession("cs_test_4", String(booking._id), { payment_status: "unpaid" }));
    expect(result).toBeNull();

    const reloaded = await BookingModel.findById(booking._id).exec();
    expect(reloaded?.status).toBe("checkout_started");
  });

  it("runs registered AFTER_BOOKING_PAID_HOOKS exactly once on the winning finalization", async () => {
    const event = await createEvent();
    const booking = await createCheckoutStartedBooking(String(event._id), "cs_test_5");
    const session = fakeStripeSession("cs_test_5", String(booking._id));

    let calls = 0;
    AFTER_BOOKING_PAID_HOOKS.push(async () => {
      calls += 1;
    });

    await finalizeBookingFromStripeSession(session);
    await finalizeBookingFromStripeSession(session); // no-op, must not re-fire the hook
    expect(calls).toBe(1);
  });

  it("a hook that throws does not undo the payment or block voucher issuance", async () => {
    const event = await createEvent();
    const booking = await createCheckoutStartedBooking(String(event._id), "cs_test_6");

    AFTER_BOOKING_PAID_HOOKS.push(async () => {
      throw new Error("invoice service unavailable");
    });

    await finalizeBookingFromStripeSession(fakeStripeSession("cs_test_6", String(booking._id)));

    const reloaded = await BookingModel.findById(booking._id).exec();
    expect(reloaded?.status).toBe("paid");
    const vouchers = await VoucherModel.find({ bookingId: booking._id }).exec();
    expect(vouchers).toHaveLength(2);
  });
});

describe("expireBookingFromStripeSession", () => {
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
    await Promise.all([EventModel.deleteMany({}), BookingModel.deleteMany({})]);
  });

  it("releases the reservation via the shared expireBooking path", async () => {
    const event = await createEvent({ capacity: 3 });
    const booking = await createCheckoutStartedBooking(String(event._id), "cs_expire_1");
    await EventModel.findByIdAndUpdate(event._id, { soldGuestCount: 2 }).exec();

    await expireBookingFromStripeSession({ id: "cs_expire_1", metadata: { tBookBookingId: String(booking._id) }, client_reference_id: null });

    const reloadedBooking = await BookingModel.findById(booking._id).exec();
    expect(reloadedBooking?.status).toBe("expired");
    const reloadedEvent = await EventModel.findById(event._id).exec();
    expect(reloadedEvent?.soldGuestCount).toBe(0);
  });

  describe("loadBookingForGuestCheckout", () => {
    it("returns the booking when the session id matches", async () => {
      const event = await createEvent();
      const booking = await createCheckoutStartedBooking(String(event._id), "cs_guest_1");
      const loaded = await loadBookingForGuestCheckout(String(booking._id), "cs_guest_1");
      expect(String(loaded._id)).toBe(String(booking._id));
    });

    it("rejects a missing booking id", async () => {
      await expect(loadBookingForGuestCheckout("", "cs_guest_1")).rejects.toMatchObject({ status: 400 });
    });

    it("rejects a missing session id", async () => {
      const event = await createEvent();
      const booking = await createCheckoutStartedBooking(String(event._id), "cs_guest_1");
      await expect(loadBookingForGuestCheckout(String(booking._id), null)).rejects.toMatchObject({ status: 400 });
    });

    it("404s for an unknown booking id", async () => {
      await expect(loadBookingForGuestCheckout("507f1f77bcf86cd799439011", "cs_guest_1")).rejects.toMatchObject({ status: 404 });
    });

    it("403s on a session id mismatch", async () => {
      const event = await createEvent();
      const booking = await createCheckoutStartedBooking(String(event._id), "cs_real_session");
      await expect(loadBookingForGuestCheckout(String(booking._id), "cs_wrong_session")).rejects.toMatchObject({ status: 403 });
    });
  });
});

describe("multi-event bundles (one Stripe session, several bookings)", () => {
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
    await Promise.all([EventModel.deleteMany({}), BookingModel.deleteMany({}), VoucherModel.deleteMany({})]);
  });

  async function bundle(sessionId: string) {
    const first = await createEvent({ capacity: 5 });
    const second = await createEvent({ name: "Második verseny", capacity: 5 });
    await EventModel.updateMany({}, { soldGuestCount: 2 }).exec();
    const a = await createCheckoutStartedBooking(String(first._id), sessionId, { checkoutBundleId: "bundle-1" });
    const b = await createCheckoutStartedBooking(String(second._id), sessionId, { checkoutBundleId: "bundle-1", eventName: "Második verseny", totalHuf: 6000 });
    const metadata = { tBookBookingId: String(a._id), tBookBookingIds: `${a._id},${b._id}`, tBookCheckoutBundleId: "bundle-1" };
    return { first, second, a, b, metadata };
  }

  it("marks every booking in the session paid and issues each one's vouchers", async () => {
    const { a, b, metadata } = await bundle("cs_bundle_1");

    const result = await finalizeBookingFromStripeSession({ id: "cs_bundle_1", payment_status: "paid", metadata, client_reference_id: String(a._id) });
    expect(result).toBe(String(a._id));

    const statuses = (await BookingModel.find({}).sort({ _id: 1 }).exec()).map((x) => x.status);
    expect(statuses).toEqual(["paid", "paid"]);
    expect(await VoucherModel.countDocuments({ bookingId: b._id })).toBe(2);

    // Retried webhook: nothing left to do.
    expect(await finalizeBookingFromStripeSession({ id: "cs_bundle_1", payment_status: "paid", metadata, client_reference_id: String(a._id) })).toBeNull();
    expect(await VoucherModel.countDocuments({})).toBe(4);
  });

  it("finds the rest of the bundle by session id when the metadata only names the primary", async () => {
    const { a } = await bundle("cs_bundle_2");
    await finalizeBookingFromStripeSession({ id: "cs_bundle_2", payment_status: "paid", metadata: { tBookBookingId: String(a._id) }, client_reference_id: null });
    expect((await BookingModel.find({ status: "paid" }).exec()).length).toBe(2);
  });

  it("does not pay a booking listed in the metadata that belongs to another session", async () => {
    const { a, metadata } = await bundle("cs_bundle_3");
    const event = await createEvent();
    const stranger = await createCheckoutStartedBooking(String(event._id), "cs_someone_else");

    await finalizeBookingFromStripeSession({
      id: "cs_bundle_3",
      payment_status: "paid",
      metadata: { ...metadata, tBookBookingIds: `${metadata.tBookBookingIds},${stranger._id}` },
      client_reference_id: String(a._id),
    });
    expect((await BookingModel.findById(stranger._id).exec())?.status).toBe("checkout_started");
  });

  it("expires every booking in the session and releases each event's capacity", async () => {
    const { first, second, a, metadata } = await bundle("cs_bundle_4");

    await expireBookingFromStripeSession({ id: "cs_bundle_4", metadata, client_reference_id: String(a._id) });

    const statuses = (await BookingModel.find({}).exec()).map((x) => x.status);
    expect(statuses).toEqual(["expired", "expired"]);
    expect((await EventModel.findById(first._id).exec())?.soldGuestCount).toBe(0);
    expect((await EventModel.findById(second._id).exec())?.soldGuestCount).toBe(0);
  });

  it("reports the bundle's total on the success page status", async () => {
    const { a } = await bundle("cs_bundle_5");
    const status = await getCheckoutStatus(String(a._id));
    expect(status.totalHuf).toBe(16_000);
    expect(status.guests).toBe(4);
    expect(status.eventName).toBe("Első WDF verseny, Második verseny");
  });
});
