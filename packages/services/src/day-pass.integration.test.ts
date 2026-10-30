import { MongoMemoryServer } from "mongodb-memory-server";
import { BookingModel, EventGroupModel, EventModel, OrganizationModel, VoucherModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { dayKeyOf } from "@tbook/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cancelBooking, createPendingBooking } from "./booking-service";
import { issueVoucherRowsForBooking, scanVoucher } from "./voucher-service";

const DAY = 86_400_000;
const customer = { name: "Kovács Béla", email: "bela@example.com", phone: "+36301112233", note: "" };
const dayKey = (offsetDays: number) => dayKeyOf(new Date(Date.now() + offsetDays * DAY));

describe("day-pass events", () => {
  let mongod: MongoMemoryServer;
  let eventId: string;
  const d1 = dayKey(1);
  const d2 = dayKey(2);
  const d3 = dayKey(3);

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
  });
  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });

  beforeEach(async () => {
    await Promise.all([BookingModel.deleteMany({}), EventModel.deleteMany({}), EventGroupModel.deleteMany({}), OrganizationModel.deleteMany({}), VoucherModel.deleteMany({})]);
    const org = await OrganizationModel.create({ name: "Org", slug: "org", status: "active" });
    const group = await EventGroupModel.create({ name: "G", organizationId: org._id, status: "active", apiKeyHash: "h", apiKeyHint: "x", apiKeyCreatedAt: new Date() });
    const event = await EventModel.create({
      groupId: group._id,
      organizationId: org._id,
      name: "Month of darts",
      status: "active",
      kind: "day_pass",
      startDate: new Date(`${d1}T00:00:00Z`),
      endDate: new Date(`${dayKey(10)}T00:00:00Z`),
      ticketFeeHuf: 0,
      ticketPriceBasis: "gross",
      ticketVatPercent: 27,
      // Every day priced the same, so the expected totals don't depend on which weekday the test runs on.
      dayPass: { weekdayPriceHuf: 4000, weekendPriceHuf: 4000, weekendDays: [6, 0], dailyCapacity: 5, capacityOverrides: { [d3]: 2 }, closedDays: [dayKey(4)] },
    });
    eventId = String(event._id);
  });

  const book = (dayPasses: Record<string, number>, opts = {}) =>
    createPendingBooking({ eventId, guests: 1, customer, selections: { dayPasses }, attendees: undefined }, opts);

  const sold = async () => ((await EventModel.findById(eventId))?.daySold ?? {}) as Record<string, number>;

  it("prices the basket per day and takes its size from the basket, not from `guests`", async () => {
    const booking = await book({ [d1]: 2, [d2]: 1 });
    expect(booking.guests).toBe(3);
    expect(booking.totalHuf).toBe(12_000);
    expect(booking.quote.lines).toHaveLength(2);
    expect(await sold()).toEqual({ [d1]: 2, [d2]: 1 });
  });

  it("applies the per-day capacity override and reserves nothing when one day is full", async () => {
    await book({ [d3]: 2 });
    await expect(book({ [d1]: 1, [d3]: 1 })).rejects.toThrow(/sold out|left/i);
    // The all-or-nothing guarantee: d1 must not have been incremented by the failed basket.
    expect(await sold()).toEqual({ [d3]: 2 });
  });

  it("does not oversell when many buyers race for the last passes", async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => book({ [d1]: 1 })));
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(5);
    expect((await sold())[d1]).toBe(5);
  });

  it("rejects closed days, days outside the event, and a malformed basket", async () => {
    await expect(book({ [dayKey(4)]: 1 })).rejects.toThrow(/No passes are sold/);
    await expect(book({ [dayKey(40)]: 1 })).rejects.toThrow(/outside this event/);
    await expect(book({})).rejects.toThrow(/at least one day/);
    expect(await sold()).toEqual({});
  });

  it("lets a console user sell past a day's cap only when they say so", async () => {
    await book({ [d3]: 2 });
    await book({ [d3]: 1 }, { allowOverCapacity: true });
    expect((await sold())[d3]).toBe(3);
  });

  it("releases each day when the booking is cancelled", async () => {
    const booking = await book({ [d1]: 2, [d2]: 1 });
    await BookingModel.updateOne({ _id: booking._id }, { status: "paid" });
    await cancelBooking(String(booking._id));
    expect(await sold()).toEqual({ [d1]: 0, [d2]: 0 });
  });

  it("issues one pass per ticket, dated, and only admits it on its own day", async () => {
    const booking = await book({ [d2]: 1, [d1]: 1 });
    await BookingModel.updateOne({ _id: booking._id }, { status: "paid" });
    const vouchers = await issueVoucherRowsForBooking(String(booking._id));

    expect(vouchers.map((v) => v.validDate)).toEqual([d1, d2]);
    expect(dayKeyOf(vouchers[0]!.eventSnapshot.startDate)).toBe(d1);

    // Scan on d1: its own pass admits, the d2 pass is refused.
    const onD1 = new Date(`${d1}T10:00:00Z`);
    const wrong = await scanVoucher(vouchers[1]!.token, { now: onD1 });
    expect(wrong.result).toBe("wrong_day");
    const right = await scanVoucher(vouchers[0]!.token, { now: onD1 });
    expect(right.result).toBe("valid");
    const again = await scanVoucher(vouchers[0]!.token, { now: onD1 });
    expect(again.result).toBe("duplicate");
  });
});
