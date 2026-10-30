import { MongoMemoryServer } from "mongodb-memory-server";
import { Types } from "mongoose";
import {
  BookingModel,
  EventGroupModel,
  EventModel,
  OrganizationModel,
  VoucherModel,
  dbConnect,
  dbDisconnectAll,
} from "@tbook/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPosSale } from "./pos-service";

const ACTOR = { userId: new Types.ObjectId().toHexString() };
const customer = { name: "Kovács Béla", email: "bela@example.com", phone: "+36301112233", note: "" };
const billing = { billingType: "personal" as const, name: "Kovács Béla", zip: "1051", city: "Budapest", street: "Fő utca 1.", countryCode: "HU", taxNumber: "" };

describe("pos-service", () => {
  let mongod: MongoMemoryServer;
  let orgId: string;
  let eventId: string;
  let fullEventId: string;

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
    vi.spyOn(console, "error").mockImplementation(() => {});

    const org = await OrganizationModel.create({ name: "Org", slug: "org", status: "active" });
    orgId = String(org._id);
    const group = await EventGroupModel.create({ name: "G", organizationId: org._id, status: "active", apiKeyHash: "h", apiKeyHint: "x", apiKeyCreatedAt: new Date() });
    const day = 86_400_000;
    const base = {
      groupId: group._id,
      organizationId: org._id,
      status: "active" as const,
      startDate: new Date(Date.now() + day),
      endDate: new Date(Date.now() + 2 * day),
      ticketFeeHuf: 10_000,
      ticketPriceBasis: "gross" as const,
      ticketVatPercent: 27,
      vouchersEnabled: true,
    };
    eventId = String((await EventModel.create({ ...base, name: "Open", capacity: 10 }))._id);
    fullEventId = String((await EventModel.create({ ...base, name: "Full", capacity: 1, soldGuestCount: 1 }))._id);
  });

  it("sells paid tickets at the counter: paid, source pos, vouchers issued", async () => {
    const result = await createPosSale(orgId, { eventId, tickets: 2, customer, billing, paymentMethod: "cash", reference: "R-1" }, ACTOR);

    expect(result.vouchersIssued).toBe(2);
    expect(result.totalHuf).toBe(20_000);

    const booking = await BookingModel.findById(result.bookingId);
    expect(booking?.status).toBe("paid");
    expect(booking?.source).toBe("pos");
    expect(booking?.paymentMethod).toBe("cash");
    expect(booking?.offlinePayment?.reference).toBe("R-1");
    expect((await EventModel.findById(eventId))?.soldGuestCount).toBe(2);
  });

  it("records a card sale", async () => {
    const { bookingId } = await createPosSale(orgId, { eventId, tickets: 1, customer, billing, paymentMethod: "card", reference: "TX-9" }, ACTOR);
    expect((await BookingModel.findById(bookingId))?.paymentMethod).toBe("card");
  });

  it("never sells past capacity — a seller has no override", async () => {
    await expect(createPosSale(orgId, { eventId: fullEventId, tickets: 1, customer, billing, paymentMethod: "cash" }, ACTOR)).rejects.toThrow();
    expect(await BookingModel.countDocuments({ eventId: fullEventId })).toBe(0);
  });

  it("refuses another org's event", async () => {
    const other = await OrganizationModel.create({ name: "Other", slug: "other", status: "active" });
    await expect(createPosSale(String(other._id), { eventId, tickets: 1, customer, billing, paymentMethod: "cash" }, ACTOR)).rejects.toThrow(/not found/i);
  });
});
