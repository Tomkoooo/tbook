import { MongoMemoryServer } from "mongodb-memory-server";
import { BookingModel, EventGroupModel, EventModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { generateApiKey, hashApiKey } from "@tbook/services";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level smoke tests: import and invoke the actual Next.js route
 * handler functions with constructed Request objects — no server needed.
 * Prefers exercising the underlying service functions (already covered by
 * packages/services' own test suites) over exhaustively testing route
 * plumbing; this file checks the auth/rate-limit/envelope wiring and one
 * true end-to-end happy path per route.
 */

const { createSession } = vi.hoisted(() => ({
  createSession: vi.fn(async (_params: Record<string, unknown>) => ({
    id: "cs_test_fake_session",
    url: "https://checkout.stripe.com/pay/cs_test_fake_session",
    payment_intent: "pi_test_fake",
  })),
}));

vi.mock("stripe", () => {
  class FakeStripe {
    checkout = { sessions: { create: createSession } };
  }
  return { default: FakeStripe };
});

async function createGroup(overrides: Partial<Record<string, unknown>> = {}) {
  const plaintextKey = generateApiKey();
  const group = await EventGroupModel.create({
    name: "World Darts Festival",
    status: "active",
    apiKeyHash: hashApiKey(plaintextKey),
    apiKeyHint: "tbk_xxxx",
    apiKeyCreatedAt: new Date(),
    ...overrides,
  });
  return { group, plaintextKey };
}

async function createEvent(groupId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return EventModel.create({
    groupId,
    name: "Első WDF verseny",
    status: "active",
    startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    endDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    ticketFeeHuf: 5000,
    ticketFeeMode: "per_person",
    ticketPriceBasis: "gross",
    ticketVatPercent: 27,
    publicListing: "listed",
    capacity: 10,
    ...overrides,
  });
}

describe("v1 public API routes", () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    // The request layer's ensureDbConnection guard reads DATABASE_URL, the
    // same way production does, so the test has to set it rather than rely
    // on its own dbConnect call alone. dbConnect caches per URI, so this
    // reuses the very connection opened on the next line.
    process.env.DATABASE_URL = mongod.getUri();
    await dbConnect(mongod.getUri());
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  });

  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
    delete process.env.STRIPE_SECRET_KEY;
  });

  beforeEach(async () => {
    await Promise.all([EventGroupModel.deleteMany({}), EventModel.deleteMany({}), BookingModel.deleteMany({})]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/v1/events", () => {
    it("returns the group's active events with a valid API key", async () => {
      const { GET } = await import("./events/route");
      const { group, plaintextKey } = await createGroup();
      await createEvent(String(group._id));

      const response = await GET(new Request("https://tbook.example.com/api/v1/events", { headers: { "X-TBook-Api-Key": plaintextKey } }));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.events).toHaveLength(1);
    });

    it("401s with no API key", async () => {
      const { GET } = await import("./events/route");
      const response = await GET(new Request("https://tbook.example.com/api/v1/events"));
      expect(response.status).toBe(401);
      expect((await response.json()).error).toBeTruthy();
    });

    it("401s with an invalid API key", async () => {
      const { GET } = await import("./events/route");
      const response = await GET(new Request("https://tbook.example.com/api/v1/events", { headers: { "X-TBook-Api-Key": "tbk_not_real" } }));
      expect(response.status).toBe(401);
    });
  });

  describe("POST /api/v1/quote", () => {
    it("returns a server-computed quote for a ticket-only event", async () => {
      const { POST } = await import("./quote/route");
      const { group, plaintextKey } = await createGroup();
      const event = await createEvent(String(group._id));

      const response = await POST(
        new Request("https://tbook.example.com/api/v1/quote", {
          method: "POST",
          headers: { "X-TBook-Api-Key": plaintextKey, "Content-Type": "application/json" },
          body: JSON.stringify({ eventId: String(event._id), guests: 2 }),
        }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.quote.totalHuf).toBe(10_000);
    });

    it("quotes several events together for the multi-event entries shape", async () => {
      const { POST } = await import("./quote/route");
      const { group, plaintextKey } = await createGroup();
      const first = await createEvent(String(group._id));
      const second = await createEvent(String(group._id), { name: "Második verseny", ticketFeeHuf: 3000 });

      const response = await POST(
        new Request("https://tbook.example.com/api/v1/quote", {
          method: "POST",
          headers: { "X-TBook-Api-Key": plaintextKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            lodgingMode: "separate",
            entries: [
              { eventId: String(first._id), guests: 2 },
              { eventId: String(second._id), guests: 1 },
            ],
          }),
        }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.lodgingMode).toBe("separate");
      expect(body.entries.map((e: { eventName: string; quote: { totalHuf: number } }) => [e.eventName, e.quote.totalHuf])).toEqual([
        ["Első WDF verseny", 10_000],
        ["Második verseny", 3000],
      ]);
      expect(body.quote.totalHuf).toBe(13_000);
      expect(body.quote.guests).toBe(3);
      expect(body.quote.lines[0].label).toMatch(/^Első WDF verseny: /);
    });

    it("refuses a multi-event quote for an event outside the key's group", async () => {
      const { POST } = await import("./quote/route");
      const { group, plaintextKey } = await createGroup();
      const { group: other } = await createGroup({ name: "Other", apiKeyHash: "other-hash" });
      const mine = await createEvent(String(group._id));
      const foreign = await createEvent(String(other._id));

      const response = await POST(
        new Request("https://tbook.example.com/api/v1/quote", {
          method: "POST",
          headers: { "X-TBook-Api-Key": plaintextKey, "Content-Type": "application/json" },
          body: JSON.stringify({ entries: [{ eventId: String(mine._id), guests: 1 }, { eventId: String(foreign._id), guests: 1 }] }),
        }),
      );
      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/v1/bookings", () => {
    it("creates a pending booking and opens a Stripe checkout session", async () => {
      const { POST } = await import("./bookings/route");
      const { group, plaintextKey } = await createGroup();
      const event = await createEvent(String(group._id));

      const response = await POST(
        new Request("https://tbook.example.com/api/v1/bookings", {
          method: "POST",
          headers: { "X-TBook-Api-Key": plaintextKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId: String(event._id),
            guests: 2,
            customer: { name: "Kovács Anna", email: "anna@example.com", phone: "+36301234567" },
          }),
        }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.checkoutUrl).toContain("checkout.stripe.com");
      expect(body.stripeSessionId).toBe("cs_test_fake_session");
    });

    it("books several events in one Stripe checkout for the multi-event entries shape", async () => {
      const { POST } = await import("./bookings/route");
      const { group, plaintextKey } = await createGroup();
      const first = await createEvent(String(group._id));
      const second = await createEvent(String(group._id), { name: "Második verseny", ticketFeeHuf: 3000 });

      const response = await POST(
        new Request("https://tbook.example.com/api/v1/bookings", {
          method: "POST",
          headers: { "X-TBook-Api-Key": plaintextKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            lodgingMode: "combined",
            entries: [
              { eventId: String(first._id), guests: 2 },
              { eventId: String(second._id), guests: 1 },
            ],
            customer: { name: "Kovács Anna", email: "anna@example.com", phone: "+36301234567" },
            returnBaseUrl: "https://site.example.com",
          }),
        }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.bookingIds).toHaveLength(2);
      expect(body.bookingId).toBe(body.bookingIds[0]);
      expect(body.totalHuf).toBe(13_000);
      expect(body.checkoutBundleId).toBeTruthy();

      const bookings = await BookingModel.find({ checkoutBundleId: body.checkoutBundleId }).sort({ _id: 1 }).exec();
      expect(bookings.map((b) => [b.eventName, b.status, b.stripeSessionId])).toEqual([
        ["Első WDF verseny", "checkout_started", "cs_test_fake_session"],
        ["Második verseny", "checkout_started", "cs_test_fake_session"],
      ]);

      expect(createSession).toHaveBeenCalledTimes(1);
      const params = createSession.mock.calls[0]![0] as { line_items: unknown[]; success_url: string; metadata: Record<string, string> };
      expect(params.line_items).toHaveLength(2);
      expect(params.success_url).toMatch(/^https:\/\/site\.example\.com\/foglalas\/siker\?bookingId=/);
      expect(params.metadata.tBookBookingIds).toBe(body.bookingIds.join(","));
      expect(params.metadata.tBookCheckoutBundleId).toBe(body.checkoutBundleId);
    });

    it("gives the seats back when the Stripe session can't be opened", async () => {
      const { POST } = await import("./bookings/route");
      const { group, plaintextKey } = await createGroup();
      const first = await createEvent(String(group._id));
      const second = await createEvent(String(group._id), { name: "Második verseny" });
      createSession.mockRejectedValueOnce(new Error("Stripe is down"));

      const response = await POST(
        new Request("https://tbook.example.com/api/v1/bookings", {
          method: "POST",
          headers: { "X-TBook-Api-Key": plaintextKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            entries: [
              { eventId: String(first._id), guests: 2 },
              { eventId: String(second._id), guests: 1 },
            ],
            customer: { name: "Kovács Anna", email: "anna@example.com", phone: "+36301234567" },
          }),
        }),
      );
      expect(response.status).toBe(400);
      const events = await EventModel.find({}).exec();
      expect(events.map((e) => e.soldGuestCount ?? 0)).toEqual([0, 0]);
      const bookings = await BookingModel.find({}).exec();
      expect(bookings.map((b) => b.status)).toEqual(["expired", "expired"]);
    });

    it("rolls back the whole bundle when one event has no room left", async () => {
      const { POST } = await import("./bookings/route");
      const { group, plaintextKey } = await createGroup();
      const first = await createEvent(String(group._id));
      const full = await createEvent(String(group._id), { name: "Telt ház", capacity: 1 });

      const response = await POST(
        new Request("https://tbook.example.com/api/v1/bookings", {
          method: "POST",
          headers: { "X-TBook-Api-Key": plaintextKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            entries: [
              { eventId: String(first._id), guests: 2 },
              { eventId: String(full._id), guests: 2 },
            ],
            customer: { name: "Kovács Anna", email: "anna@example.com", phone: "+36301234567" },
          }),
        }),
      );
      expect(response.status).toBe(400);
      expect(createSession).not.toHaveBeenCalled();
      const reloaded = await EventModel.findById(first._id).exec();
      expect(reloaded?.soldGuestCount ?? 0).toBe(0);
      const left = await BookingModel.find({}).exec();
      expect(left.every((b) => b.status === "expired")).toBe(true);
    });

    it("401s with no API key", async () => {
      const { POST } = await import("./bookings/route");
      const response = await POST(
        new Request("https://tbook.example.com/api/v1/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId: "x", guests: 1, customer: { name: "A", email: "a@example.com", phone: "1" } }),
        }),
      );
      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/v1/directory", () => {
    it("requires no API key and returns listed groups with active events", async () => {
      const { GET } = await import("./directory/route");
      const { group } = await createGroup({ listOnTBookSite: true });
      await createEvent(String(group._id));

      const response = await GET(new Request("https://tbook.example.com/api/v1/directory"));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.listings).toHaveLength(1);
    });
  });
});
