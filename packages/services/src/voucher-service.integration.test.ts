import { MongoMemoryServer } from "mongodb-memory-server";
import { BookingModel, EventModel, VoucherModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  issueVoucherRowsForBooking,
  parseVoucherTokenFromScan,
  resolveAttendeeDisplayName,
  scanVoucher,
  voidVouchersForBooking,
} from "./voucher-service";

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
    ...overrides,
  });
}

async function createPaidBooking(eventId: string, overrides: Partial<Record<string, unknown>> = {}) {
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
    status: "paid",
    ...overrides,
  });
}

describe("voucher-service", () => {
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

  describe("resolveAttendeeDisplayName", () => {
    it("uses a name-like text field when present", () => {
      const schema = [{ key: "fullName", label: "Teljes név", type: "text" as const, required: true, helpText: "", sortOrder: 0 }];
      const name = resolveAttendeeDisplayName(0, [{ fields: { fullName: "Kiss Béla" } }], schema, "Kovács Anna", 1);
      expect(name).toBe("Kiss Béla");
    });

    it("falls back to the customer name for a single guest with no matching field", () => {
      const name = resolveAttendeeDisplayName(0, [{ fields: {} }], [], "Kovács Anna", 1);
      expect(name).toBe("Kovács Anna");
    });

    it("falls back to a numbered customer name for multi-guest bookings", () => {
      const name = resolveAttendeeDisplayName(1, [{ fields: {} }, { fields: {} }], [], "Kovács Anna", 2);
      expect(name).toBe("Kovács Anna (2. vendég)");
    });
  });

  describe("parseVoucherTokenFromScan", () => {
    it("returns a bare token unchanged", () => {
      expect(parseVoucherTokenFromScan(" abc-123 ")).toBe("abc-123");
    });

    it("extracts a UUID from a validation URL path", () => {
      const token = "550e8400-e29b-41d4-a716-446655440000";
      expect(parseVoucherTokenFromScan(`https://tbook.example.com/v/${token}`)).toBe(token);
    });

    it("extracts a token from a ?token= query param", () => {
      expect(parseVoucherTokenFromScan("https://tbook.example.com/scan?token=xyz-789")).toBe("xyz-789");
    });
  });

  describe("issueVoucherRowsForBooking", () => {
    it("creates one voucher row per guest with an opaque token", async () => {
      const event = await createEvent();
      const booking = await createPaidBooking(String(event._id));

      const vouchers = await issueVoucherRowsForBooking(String(booking._id));
      expect(vouchers).toHaveLength(2);
      expect(vouchers[0]?.status).toBe("active");
      expect(vouchers[0]?.token).not.toBe(vouchers[1]?.token);
      expect(vouchers[0]?.eventSnapshot.name).toBe(event.name);
    });

    it("is idempotent — a second call returns the same rows, not duplicates", async () => {
      const event = await createEvent();
      const booking = await createPaidBooking(String(event._id));

      const first = await issueVoucherRowsForBooking(String(booking._id));
      const second = await issueVoucherRowsForBooking(String(booking._id));
      expect(second.map((v) => String(v._id))).toEqual(first.map((v) => String(v._id)));

      const count = await VoucherModel.countDocuments({ bookingId: booking._id });
      expect(count).toBe(2);
    });

    it("rejects issuing vouchers for a booking that isn't paid/confirmed", async () => {
      const event = await createEvent();
      const booking = await createPaidBooking(String(event._id), { status: "pending" });
      await expect(issueVoucherRowsForBooking(String(booking._id))).rejects.toMatchObject({ code: "validation_error" });
    });

    it("returns no vouchers when the event has vouchers disabled", async () => {
      const event = await createEvent({ vouchersEnabled: false });
      const booking = await createPaidBooking(String(event._id));
      expect(await issueVoucherRowsForBooking(String(booking._id))).toEqual([]);
    });
  });

  describe("scanVoucher", () => {
    it("checks in a valid voucher exactly once", async () => {
      const event = await createEvent();
      const booking = await createPaidBooking(String(event._id));
      const [voucher] = await issueVoucherRowsForBooking(String(booking._id));

      const result = await scanVoucher(voucher!.token);
      expect(result.result).toBe("valid");
      expect(result.voucher?.status).toBe("checked_in");
    });

    it("reports duplicate on a second scan of the same voucher", async () => {
      const event = await createEvent();
      const booking = await createPaidBooking(String(event._id));
      const [voucher] = await issueVoucherRowsForBooking(String(booking._id));

      await scanVoucher(voucher!.token);
      const second = await scanVoucher(voucher!.token);
      expect(second.result).toBe("duplicate");
    });

    it("admits exactly one winner when the same voucher is scanned concurrently", async () => {
      const event = await createEvent();
      const booking = await createPaidBooking(String(event._id));
      const [voucher] = await issueVoucherRowsForBooking(String(booking._id));

      const results = await Promise.all(Array.from({ length: 5 }, () => scanVoucher(voucher!.token)));
      expect(results.filter((r) => r.result === "valid")).toHaveLength(1);
      expect(results.filter((r) => r.result === "duplicate")).toHaveLength(4);
    });

    it("reports wrong_event when scanned against a different event's scanner", async () => {
      const event = await createEvent();
      const otherEvent = await createEvent({ name: "Other event" });
      const booking = await createPaidBooking(String(event._id));
      const [voucher] = await issueVoucherRowsForBooking(String(booking._id));

      const result = await scanVoucher(voucher!.token, { eventId: String(otherEvent._id) });
      expect(result.result).toBe("wrong_event");
    });

    it("reports invalid for an unknown token", async () => {
      expect((await scanVoucher("does-not-exist")).result).toBe("invalid");
    });

    it("lookup mode reports status without checking in", async () => {
      const event = await createEvent();
      const booking = await createPaidBooking(String(event._id));
      const [voucher] = await issueVoucherRowsForBooking(String(booking._id));

      const result = await scanVoucher(voucher!.token, { mode: "lookup" });
      expect(result.result).toBe("valid");
      const reloaded = await VoucherModel.findById(voucher!._id).exec();
      expect(reloaded?.status).toBe("active"); // lookup must not consume the voucher
    });
  });

  describe("voidVouchersForBooking", () => {
    it("voids every active voucher for a cancelled booking", async () => {
      const event = await createEvent();
      const booking = await createPaidBooking(String(event._id));
      await issueVoucherRowsForBooking(String(booking._id));

      await voidVouchersForBooking(String(booking._id));
      const vouchers = await VoucherModel.find({ bookingId: booking._id }).exec();
      expect(vouchers.every((v) => v.status === "void")).toBe(true);
    });

    it("a voided voucher reports invalid, not duplicate, on scan", async () => {
      const event = await createEvent();
      const booking = await createPaidBooking(String(event._id));
      const [voucher] = await issueVoucherRowsForBooking(String(booking._id));

      await voidVouchersForBooking(String(booking._id));
      const result = await scanVoucher(voucher!.token);
      expect(result.result).toBe("invalid");
    });
  });
});
