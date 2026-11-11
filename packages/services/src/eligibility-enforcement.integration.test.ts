import { MongoMemoryServer } from "mongodb-memory-server";
import { BookingModel, EventGroupModel, EventModel, OrganizationModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPendingBooking } from "./booking-service";

/**
 * Regression: createPendingBooking spread the Mongoose event document, which
 * copies its internals rather than its fields — so every eligibility rule
 * was silently skipped on the server.
 */
describe("eligibility rules on booking creation", () => {
  let mongod: MongoMemoryServer;
  let eventId: string;
  let groupId: string;
  const customer = { name: "A", email: "a@example.com", phone: "+36301112233", note: "" };

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
  });
  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });

  beforeEach(async () => {
    await Promise.all([BookingModel.deleteMany({}), EventModel.deleteMany({}), EventGroupModel.deleteMany({}), OrganizationModel.deleteMany({})]);
    const org = await OrganizationModel.create({ name: "O", slug: "o" });
    const group = await EventGroupModel.create({ name: "G", organizationId: org._id, status: "active", apiKeyHash: "h", apiKeyHint: "x", apiKeyCreatedAt: new Date() });
    groupId = String(group._id);
    const event = await EventModel.create({
      groupId: group._id,
      organizationId: org._id,
      name: "E",
      status: "active",
      startDate: new Date(Date.now() + 86_400_000),
      endDate: new Date(Date.now() + 86_400_000),
      ticketFeeHuf: 1000,
      attendeeFieldSchema: [{ key: "code", label: "Code", type: "text", required: true }],
      eligibilityPreset: "form_rules",
      eligibilityFormRules: { logic: "and", rules: [{ id: "r", fieldKey: "code", op: "regex", value: "^A\\d{3}$", message: "Bad code" }] },
    });
    eventId = String(event._id);
  });

  it("refuses an attendee who fails a form rule", async () => {
    await expect(createPendingBooking({ eventId, guests: 1, customer, attendees: [{ fields: { code: "B123" } }] }, { groupId })).rejects.toThrow(/eligibility/);
    expect(await BookingModel.countDocuments({})).toBe(0);
  });

  it("accepts one who passes", async () => {
    const booking = await createPendingBooking({ eventId, guests: 1, customer, attendees: [{ fields: { code: "A123" } }] }, { groupId });
    expect(booking.status).toBe("pending");
  });
});
