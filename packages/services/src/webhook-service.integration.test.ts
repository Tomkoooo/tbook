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
  organizationRepository,
} from "@tbook/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bookingWebhookData,
  deleteWebhook,
  dispatchWebhookEvent,
  listWebhooks,
  resolveWebhookOrganizationId,
  sendTestWebhook,
  upsertWebhook,
  verifyWebhookSignature,
  webhookAfterBookingPaidHook,
} from "./webhook-service";
import { cancelBookingAsAdmin } from "./booking-admin-service";
import { scanVoucherAsAdmin } from "./voucher-admin-service";

describe("webhook-service", () => {
  let mongod: MongoMemoryServer;
  let orgId: string;
  let groupId: string;
  let eventId: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
  });

  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      OrganizationModel.deleteMany({}),
      EventGroupModel.deleteMany({}),
      EventModel.deleteMany({}),
      BookingModel.deleteMany({}),
      VoucherModel.deleteMany({}),
    ]);

    const org = await OrganizationModel.create({ name: "Sörfeszt Kft", slug: "sorfeszt", status: "active" });
    orgId = String(org._id);

    const group = await EventGroupModel.create({
      name: "Sörfeszt 2026",
      organizationId: org._id,
      status: "active",
      apiKeyHash: "hash",
      apiKeyHint: "tbk_xxxx",
      apiKeyCreatedAt: new Date(),
    });
    groupId = String(group._id);

    const event = await EventModel.create({
      groupId: group._id,
      organizationId: org._id,
      name: "Nyitónap",
      status: "active",
      startDate: new Date("2026-07-01"),
      endDate: new Date("2026-07-02"),
      ticketFeeHuf: 5000,
      capacity: 100,
    });
    eventId = String(event._id);
  });

  async function seedBooking(overrides: Record<string, unknown> = {}) {
    return BookingModel.create({
      organizationId: new Types.ObjectId(orgId),
      groupId: new Types.ObjectId(groupId),
      eventId: new Types.ObjectId(eventId),
      eventName: "Nyitónap",
      groupName: "Sörfeszt 2026",
      customer: { name: "Kovács Béla", email: "bela@example.com", phone: "+36301234567" },
      guests: 2,
      quote: { guests: 2, ticketSubtotalHuf: 10000, totalHuf: 10000 },
      totalHuf: 10000,
      status: "paid",
      ...overrides,
    });
  }

  describe("endpoint management", () => {
    it("creates an endpoint, returning the signing secret exactly once", async () => {
      const { webhook, secret } = await upsertWebhook({
        organizationId: orgId,
        url: "https://example.test/hook",
        events: ["booking.paid"],
      });

      expect(secret).toMatch(/^whsec_/);
      expect(webhook.secretEnc).not.toBe("");
      expect(webhook.secretEnc).not.toContain(secret!);

      // A later read never exposes the plaintext again.
      const [stored] = await listWebhooks(orgId);
      expect(stored?.secretEnc).toBeTruthy();
      expect(JSON.stringify(stored)).not.toContain(secret!);
    });

    it("updates an existing endpoint without rotating its secret", async () => {
      const created = await upsertWebhook({ organizationId: orgId, url: "https://a.test", events: ["booking.paid"] });

      await upsertWebhook({
        organizationId: orgId,
        id: created.webhook.id,
        url: "https://b.test",
        events: ["booking.paid", "booking.cancelled"],
        enabled: false,
      });

      const [stored] = await listWebhooks(orgId);
      expect(stored?.url).toBe("https://b.test");
      expect(stored?.events).toEqual(["booking.paid", "booking.cancelled"]);
      expect(stored?.enabled).toBe(false);
      expect(stored?.secretEnc).toBe(created.webhook.secretEnc);
    });

    it("deletes an endpoint by id, leaving the others", async () => {
      const a = await upsertWebhook({ organizationId: orgId, url: "https://a.test", events: ["booking.paid"] });
      await upsertWebhook({ organizationId: orgId, url: "https://b.test", events: ["booking.paid"] });

      await deleteWebhook(orgId, a.webhook.id);

      const remaining = await listWebhooks(orgId);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.url).toBe("https://b.test");
    });

    it("returns an empty list for an org that has never configured one", async () => {
      expect(await listWebhooks(orgId)).toEqual([]);
    });
  });

  describe("dispatch", () => {
    it("delivers a correctly signed payload the receiver can verify", async () => {
      const { secret } = await upsertWebhook({
        organizationId: orgId,
        url: "https://example.test/hook",
        events: ["booking.paid"],
      });

      let seenBody = "";
      let seenSignature = "";
      const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
        seenBody = String(init?.body);
        seenSignature = (init?.headers as Record<string, string>)["X-TBook-Signature"] ?? "";
        return new Response("", { status: 200 });
      });

      await dispatchWebhookEvent(orgId, "booking.paid", { id: "abc" }, { fetchImpl: fetchImpl as unknown as typeof fetch });

      expect(verifyWebhookSignature(seenBody, secret!, seenSignature)).toBe(true);
    });

    it("only delivers to endpoints subscribed to that event", async () => {
      await upsertWebhook({ organizationId: orgId, url: "https://paid.test", events: ["booking.paid"] });
      await upsertWebhook({ organizationId: orgId, url: "https://cancel.test", events: ["booking.cancelled"] });

      const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
      await dispatchWebhookEvent(orgId, "booking.cancelled", {}, { fetchImpl: fetchImpl as unknown as typeof fetch });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("https://cancel.test");
    });

    it("skips a disabled endpoint", async () => {
      const created = await upsertWebhook({ organizationId: orgId, url: "https://a.test", events: ["booking.paid"] });
      await upsertWebhook({
        organizationId: orgId,
        id: created.webhook.id,
        url: "https://a.test",
        events: ["booking.paid"],
        enabled: false,
      });

      const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
      await dispatchWebhookEvent(orgId, "booking.paid", {}, { fetchImpl: fetchImpl as unknown as typeof fetch });

      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("records a failure on the endpoint so the console can show it", async () => {
      const created = await upsertWebhook({ organizationId: orgId, url: "https://a.test", events: ["booking.paid"] });

      const fetchImpl = vi.fn(async () => new Response("bad", { status: 503 }));
      await dispatchWebhookEvent(orgId, "booking.paid", {}, { fetchImpl: fetchImpl as unknown as typeof fetch });

      const [stored] = await listWebhooks(orgId);
      expect(stored?.id).toBe(created.webhook.id);
      expect(stored?.lastStatus).toBe(503);
      expect(stored?.lastError).toBe("HTTP 503");
      expect(stored?.lastDeliveredAt).toBeInstanceOf(Date);
    });

    it("never throws when an endpoint is unreachable", async () => {
      await upsertWebhook({ organizationId: orgId, url: "https://a.test", events: ["booking.paid"] });

      const fetchImpl = vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      });

      // The whole contract: a broken integration must not fail the
      // business operation that produced the event.
      await expect(
        dispatchWebhookEvent(orgId, "booking.paid", {}, { fetchImpl: fetchImpl as unknown as typeof fetch }),
      ).resolves.toMatchObject([{ ok: false }]);
    });

    it("delivers to several endpoints independently, one failure not blocking the other", async () => {
      await upsertWebhook({ organizationId: orgId, url: "https://good.test", events: ["booking.paid"] });
      await upsertWebhook({ organizationId: orgId, url: "https://bad.test", events: ["booking.paid"] });

      const fetchImpl = vi.fn(async (url: string) => {
        if (url === "https://bad.test") throw new Error("down");
        return new Response("", { status: 200 });
      });

      const outcomes = await dispatchWebhookEvent(
        orgId,
        "booking.paid",
        {},
        { fetchImpl: fetchImpl as unknown as typeof fetch },
      );

      expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
      expect(outcomes.filter((outcome) => !outcome.ok)).toHaveLength(1);
    });

    it("is a no-op for a null organization rather than an error", async () => {
      await expect(dispatchWebhookEvent(null, "booking.paid", {})).resolves.toEqual([]);
    });
  });

  describe("payload shape", () => {
    it("publishes a curated projection, never Stripe ids or the attendee schema snapshot", async () => {
      const booking = await seedBooking({
        stripeSessionId: "cs_test_secret",
        stripePaymentIntentId: "pi_test_secret",
        attendeeFieldSchema: [{ key: "x", label: "X", type: "text", required: false }],
      });

      const data = JSON.stringify(bookingWebhookData(booking));
      expect(data).not.toContain("cs_test_secret");
      expect(data).not.toContain("pi_test_secret");
      expect(data).not.toContain("attendeeFieldSchema");
      expect(data).toContain("bela@example.com");
    });
  });

  describe("event wiring", () => {
    it("fires booking.paid from the after-payment hook", async () => {
      await upsertWebhook({ organizationId: orgId, url: "https://a.test", events: ["booking.paid"] });
      const booking = await seedBooking();

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
      await webhookAfterBookingPaidHook(booking);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const body = JSON.parse(String((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body));
      expect(body.event).toBe("booking.paid");
      expect(body.data.customer.email).toBe("bela@example.com");
      fetchSpy.mockRestore();
    });

    it("resolves the org via the group for a legacy booking with no organizationId", async () => {
      // Without this fallback an org's oldest bookings would never fire.
      const booking = await seedBooking({ organizationId: null });
      expect(await resolveWebhookOrganizationId(booking)).toBe(orgId);
    });

    it("fires booking.cancelled from an admin cancellation", async () => {
      await upsertWebhook({ organizationId: orgId, url: "https://a.test", events: ["booking.cancelled"] });
      const booking = await seedBooking({ status: "paid" });

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
      await cancelBookingAsAdmin(orgId, String(booking._id), { reason: "no-show" });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const body = JSON.parse(String((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body));
      expect(body.event).toBe("booking.cancelled");
      expect(body.data.status).toBe("cancelled");
      fetchSpy.mockRestore();
    });

    it("fires voucher.checked_in on a first scan but not on a duplicate", async () => {
      await upsertWebhook({ organizationId: orgId, url: "https://a.test", events: ["voucher.checked_in"] });
      const voucher = await VoucherModel.create({
        organizationId: new Types.ObjectId(orgId),
        eventId: new Types.ObjectId(eventId),
        bookingId: new Types.ObjectId(),
        attendeeIndex: 0,
        token: "tok-scan",
        status: "active",
        displayName: "Kovács Béla",
        eventSnapshot: { name: "Nyitónap", startDate: new Date("2026-07-01"), endDate: new Date("2026-07-02") },
      });

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));

      await scanVoucherAsAdmin(orgId, voucher.token, { eventId });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // A door queue re-scanning the same code must not spam integrations.
      await scanVoucherAsAdmin(orgId, voucher.token, { eventId });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      fetchSpy.mockRestore();
    });

    it("does not fire on a lookup-mode scan, which checks nobody in", async () => {
      await upsertWebhook({ organizationId: orgId, url: "https://a.test", events: ["voucher.checked_in"] });
      const voucher = await VoucherModel.create({
        organizationId: new Types.ObjectId(orgId),
        eventId: new Types.ObjectId(eventId),
        bookingId: new Types.ObjectId(),
        attendeeIndex: 0,
        token: "tok-lookup",
        status: "active",
        displayName: "Kovács Béla",
        eventSnapshot: { name: "Nyitónap", startDate: new Date("2026-07-01"), endDate: new Date("2026-07-02") },
      });

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
      await scanVoucherAsAdmin(orgId, voucher.token, { eventId, mode: "lookup" });

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  describe("test delivery", () => {
    it("sends a signed sample payload flagged as a test", async () => {
      const created = await upsertWebhook({ organizationId: orgId, url: "https://a.test", events: ["booking.paid"] });

      let body = "";
      const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
        body = String(init?.body);
        return new Response("", { status: 200 });
      });

      const outcome = await sendTestWebhook(orgId, created.webhook.id, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      expect(outcome.ok).toBe(true);
      expect(JSON.parse(body).data.test).toBe(true);
    });

    it("records the test delivery's outcome like any other", async () => {
      const created = await upsertWebhook({ organizationId: orgId, url: "https://a.test", events: ["booking.paid"] });

      const fetchImpl = vi.fn(async () => new Response("", { status: 404 }));
      await sendTestWebhook(orgId, created.webhook.id, { fetchImpl: fetchImpl as unknown as typeof fetch });

      const [stored] = await listWebhooks(orgId);
      expect(stored?.lastStatus).toBe(404);
    });

    it("rejects an unknown endpoint id", async () => {
      await expect(sendTestWebhook(orgId, "nope")).rejects.toThrow("Webhook not found");
    });
  });

  describe("org settings compatibility", () => {
    it("leaves an org document with no webhooks array readable and unchanged", async () => {
      // Every existing production org predates this feature.
      const org = await organizationRepository.findById(orgId);
      expect(org?.settings?.webhooks).toBeUndefined();
      expect(await listWebhooks(orgId)).toEqual([]);
    });
  });
});
