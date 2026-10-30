import { MongoMemoryServer } from "mongodb-memory-server";
import Stripe from "stripe";
import { BookingModel, EventModel, OrganizationModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleStripeWebhook } from "./checkout-service";
import { encryptOrgSecret } from "./org-secrets";

const SECRET = "whsec_test_org_secret";

function signed(payload: object, secret = SECRET) {
  const body = JSON.stringify(payload);
  const signature = new Stripe("sk_x").webhooks.generateTestHeaderString({ payload: body, secret });
  return { body, signature };
}

describe("handleStripeWebhook", () => {
  let mongod: MongoMemoryServer;
  let orgId: string;
  let bookingId: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
  });
  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(async () => {
    await Promise.all([BookingModel.deleteMany({}), EventModel.deleteMany({}), OrganizationModel.deleteMany({})]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const org = await OrganizationModel.create({
      name: "Org",
      slug: "org",
      status: "active",
      settings: { stripe: { enabled: true, secretKeyEnc: encryptOrgSecret("sk_live_x"), webhookSecretEnc: encryptOrgSecret(SECRET) } },
    });
    orgId = String(org._id);
    const event = await EventModel.create({ name: "E", status: "active", startDate: new Date(), endDate: new Date(), ticketFeeHuf: 5000, capacity: 10, soldGuestCount: 2 });
    const booking = await BookingModel.create({
      organizationId: org._id,
      eventId: event._id,
      eventName: "E",
      customer: { name: "A", email: "a@example.com", phone: "1", note: "" },
      attendeeFieldSchema: [],
      guests: 2,
      attendees: [{ fields: {} }, { fields: {} }],
      selections: {},
      quote: { guests: 2, totalHuf: 10_000, ticketSubtotalHuf: 10_000, lines: [] },
      totalHuf: 10_000,
      currency: "HUF",
      status: "checkout_started",
      stripeSessionId: "cs_1",
    });
    bookingId = String(booking._id);
  });

  const sessionEvent = (type: string, extra: object = {}) => ({
    id: "evt_1",
    object: "event",
    type,
    data: { object: { id: "cs_1", payment_status: "paid", metadata: { tBookBookingId: bookingId, tBookOrganizationId: orgId }, client_reference_id: bookingId, ...extra } },
  });

  it("marks the booking paid on a correctly signed completed session", async () => {
    const { body, signature } = signed(sessionEvent("checkout.session.completed"));
    expect(await handleStripeWebhook(body, signature)).toEqual({ handled: true, type: "checkout.session.completed" });
    expect((await BookingModel.findById(bookingId))?.status).toBe("paid");
  });

  it("rejects a payload signed with the wrong secret and changes nothing", async () => {
    const { body, signature } = signed(sessionEvent("checkout.session.completed"), "whsec_attacker");
    await expect(handleStripeWebhook(body, signature)).rejects.toThrow(/signature/i);
    expect((await BookingModel.findById(bookingId))?.status).toBe("checkout_started");
  });

  it("rejects a tampered body", async () => {
    const { body, signature } = signed(sessionEvent("checkout.session.completed"));
    await expect(handleStripeWebhook(body.replace("cs_1", "cs_2"), signature)).rejects.toThrow(/signature/i);
  });

  it("releases the reservation when the session expires", async () => {
    const { body, signature } = signed(sessionEvent("checkout.session.expired", { payment_status: "unpaid" }));
    await handleStripeWebhook(body, signature);
    expect((await BookingModel.findById(bookingId))?.status).toBe("expired");
    expect((await EventModel.findOne({}))?.soldGuestCount).toBe(0);
  });

  it("ignores event types it doesn't act on", async () => {
    const { body, signature } = signed({ id: "evt_2", object: "event", type: "charge.refunded", data: { object: { metadata: { tBookOrganizationId: orgId } } } });
    expect(await handleStripeWebhook(body, signature)).toEqual({ handled: false, type: "charge.refunded" });
  });

  it("falls back to the platform secret for orgs without their own", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_platform");
    const noOrg = sessionEvent("checkout.session.completed", { metadata: { tBookBookingId: bookingId } });
    const { body, signature } = signed(noOrg, "whsec_platform");
    await handleStripeWebhook(body, signature);
    expect((await BookingModel.findById(bookingId))?.status).toBe("paid");
  });
});
