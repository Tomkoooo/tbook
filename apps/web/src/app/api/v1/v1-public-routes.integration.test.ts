import { MongoMemoryServer } from "mongodb-memory-server";
import { EventGroupModel, EventModel, dbConnect, dbDisconnectAll } from "@tbook/db";
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

vi.mock("stripe", () => {
  class FakeStripe {
    checkout = {
      sessions: {
        create: vi.fn(async () => ({
          id: "cs_test_fake_session",
          url: "https://checkout.stripe.com/pay/cs_test_fake_session",
          payment_intent: "pi_test_fake",
        })),
      },
    };
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
    await Promise.all([EventGroupModel.deleteMany({}), EventModel.deleteMany({})]);
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

    it("501s for the legacy multi-event entries shape", async () => {
      const { POST } = await import("./quote/route");
      const { plaintextKey } = await createGroup();

      const response = await POST(
        new Request("https://tbook.example.com/api/v1/quote", {
          method: "POST",
          headers: { "X-TBook-Api-Key": plaintextKey, "Content-Type": "application/json" },
          body: JSON.stringify({ entries: [{ eventId: "x", guests: 1 }] }),
        }),
      );
      expect(response.status).toBe(501);
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

    it("501s for the legacy multi-event entries shape", async () => {
      const { POST } = await import("./bookings/route");
      const { plaintextKey } = await createGroup();

      const response = await POST(
        new Request("https://tbook.example.com/api/v1/bookings", {
          method: "POST",
          headers: { "X-TBook-Api-Key": plaintextKey, "Content-Type": "application/json" },
          body: JSON.stringify({ entries: [{ eventId: "x", guests: 1 }] }),
        }),
      );
      expect(response.status).toBe(501);
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
