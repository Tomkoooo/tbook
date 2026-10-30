import { MongoMemoryServer } from "mongodb-memory-server";
import { Types } from "mongoose";
import { BookingModel, EventGroupModel, EventModel, OrganizationModel, VoucherModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptOrgSecret } from "./org-secrets";
import {
  cancelSumUpCardSale,
  getSumUpSettings,
  handleSumUpWebhook,
  listSellableReaders,
  pairSumUpReader,
  saveSumUpSettings,
  settleSumUpCheckout,
  startSumUpCardSale,
} from "./sumup-service";

const ACTOR = { userId: new Types.ObjectId().toHexString() };
const customer = { name: "Kovács Béla", email: "bela@example.com", phone: "+36301112233", note: "" };
const billing = { billingType: "personal" as const, name: "Kovács Béla", zip: "1051", city: "Budapest", street: "Fő utca 1.", countryCode: "HU", taxNumber: "" };

/** Scripted SumUp: each handler decides the response for a method + path prefix. */
function fakeSumUp(handlers: Record<string, (req: { body: unknown; url: string }) => { status: number; body?: unknown }>) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, url, body });
    const key = Object.keys(handlers).find((k) => `${method} ${url.replace("https://api.sumup.com", "")}`.startsWith(k));
    if (!key) throw new Error(`unscripted SumUp call: ${method} ${url}`);
    const { status, body: respBody } = handlers[key]!({ body, url });
    return new Response(respBody === undefined ? "" : JSON.stringify(respBody), { status });
  });
  return { http: { fetch: fetchImpl as unknown as typeof fetch }, calls };
}

describe("sumup-service", () => {
  let mongod: MongoMemoryServer;
  let orgId: string;
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
    await Promise.all([BookingModel.deleteMany({}), EventModel.deleteMany({}), EventGroupModel.deleteMany({}), OrganizationModel.deleteMany({}), VoucherModel.deleteMany({})]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const org = await OrganizationModel.create({
      name: "Org",
      slug: "org",
      status: "active",
      settings: {
        sumup: {
          enabled: true,
          merchantCode: "MH4H92C7",
          apiKeyEnc: encryptOrgSecret("sup_sk_secret"),
          affiliateAppId: "app.tbook",
          affiliateKeyEnc: encryptOrgSecret("aff-key"),
          readers: [{ id: "rdr_1", name: "Counter 1", model: "solo" }],
        },
      },
    });
    orgId = String(org._id);
    const group = await EventGroupModel.create({ name: "G", organizationId: org._id, status: "active", apiKeyHash: "h", apiKeyHint: "x", apiKeyCreatedAt: new Date() });
    eventId = String(
      (
        await EventModel.create({
          groupId: group._id,
          organizationId: org._id,
          name: "Open",
          status: "active",
          startDate: new Date(Date.now() + 86_400_000),
          endDate: new Date(Date.now() + 2 * 86_400_000),
          ticketFeeHuf: 10_000,
          ticketPriceBasis: "gross",
          ticketVatPercent: 27,
          capacity: 5,
        })
      )._id,
    );
  });

  // eventId is assigned per test, so the sale input has to be read lazily.
  const makeSale = () => ({ eventId, tickets: 2, customer, billing, paymentMethod: "card" as const, readerId: "rdr_1" });
  const checkoutOk = { "POST /v0.1/merchants/MH4H92C7/readers/rdr_1/checkout": () => ({ status: 201, body: { data: { client_transaction_id: "ctx-1" } } }) };
  const txn = (status: string, amount = 20_000) => ({
    "GET /v2.1/merchants/MH4H92C7/transactions": () => ({ status: 200, body: { client_transaction_id: "ctx-1", status, amount, currency: "HUF", transaction_code: "TEENSK4W2K" } }),
  });

  it("never exposes stored secrets in the settings view", async () => {
    const view = await getSumUpSettings(orgId);
    expect(view.apiKey.configured).toBe(true);
    expect(JSON.stringify(view)).not.toContain("sup_sk_secret");
    expect(JSON.stringify(view)).not.toContain("aff-key");
  });

  it("keeps a stored secret when the form leaves it blank, and refuses to enable half-configured", async () => {
    await saveSumUpSettings(orgId, { enabled: true, merchantCode: "MH4H92C7", apiKey: "", affiliateAppId: "app.tbook", affiliateKey: "" });
    expect((await getSumUpSettings(orgId)).apiKey.configured).toBe(true);
    await expect(saveSumUpSettings(orgId, { enabled: true, merchantCode: "", apiKey: "", affiliateAppId: "x", affiliateKey: "" })).rejects.toThrow(/merchant code/);
  });

  it("pairs a reader and lists it", async () => {
    const { http, calls } = fakeSumUp({
      "POST /v0.1/merchants/MH4H92C7/readers": () => ({ status: 201, body: { id: "rdr_2", name: "Bar", status: "paired", device: { model: "solo" } } }),
    });
    await pairSumUpReader(orgId, { pairingCode: "ABCD1234", name: "Bar" }, http);
    expect(calls[0]!.body).toEqual({ pairing_code: "ABCD1234", name: "Bar" });
    expect((await listSellableReaders(orgId)).map((r) => r.id)).toEqual(["rdr_1", "rdr_2"]);
  });

  it("pushes the amount to the reader and holds the tickets while waiting", async () => {
    const { http, calls } = fakeSumUp(checkoutOk);
    const { bookingId, clientTransactionId } = await startSumUpCardSale(orgId, makeSale(), ACTOR, http);

    expect(clientTransactionId).toBe("ctx-1");
    expect(calls[0]!.body).toMatchObject({ total_amount: { currency: "HUF", minor_unit: 2, value: 2_000_000 }, affiliate: { app_id: "app.tbook", key: "aff-key" } });
    const booking = await BookingModel.findById(bookingId);
    expect(booking?.status).toBe("pending");
    expect(booking?.source).toBe("pos");
    expect(booking?.cardCheckout?.status).toBe("waiting");
    expect((await EventModel.findById(eventId))?.soldGuestCount).toBe(2);
  });

  it("cancels the sale again, releasing the tickets, when the reader is offline", async () => {
    const { http } = fakeSumUp({ "POST /v0.1/merchants/MH4H92C7/readers/rdr_1/checkout": () => ({ status: 422, body: { errors: { detail: "READER_OFFLINE" } } }) });
    await expect(startSumUpCardSale(orgId, makeSale(), ACTOR, http)).rejects.toThrow(/offline/);
    expect((await BookingModel.findOne({}))?.status).toBe("cancelled");
    expect((await EventModel.findById(eventId))?.soldGuestCount).toBe(0);
  });

  it("settles a successful payment: paid, tickets issued, card method and receipt recorded", async () => {
    const start = fakeSumUp(checkoutOk);
    const { bookingId } = await startSumUpCardSale(orgId, makeSale(), ACTOR, start.http);

    expect((await settleSumUpCheckout(bookingId, fakeSumUp(txn("PENDING")).http)).state).toBe("waiting");

    const result = await settleSumUpCheckout(bookingId, fakeSumUp(txn("SUCCESSFUL")).http);
    expect(result.state).toBe("paid");
    const booking = await BookingModel.findById(bookingId);
    expect(booking?.status).toBe("paid");
    expect(booking?.paymentMethod).toBe("card");
    expect(booking?.offlinePayment?.reference).toBe("TEENSK4W2K");
    expect(await VoucherModel.countDocuments({ bookingId })).toBe(2);
  });

  it("is idempotent when the webhook and the seller's poll settle the same sale", async () => {
    const { bookingId } = await startSumUpCardSale(orgId, makeSale(), ACTOR, fakeSumUp(checkoutOk).http);
    const http = fakeSumUp(txn("SUCCESSFUL")).http;
    await Promise.all([settleSumUpCheckout(bookingId, http), settleSumUpCheckout(bookingId, http), settleSumUpCheckout(bookingId, http)]);
    expect(await VoucherModel.countDocuments({ bookingId })).toBe(2);
    expect((await settleSumUpCheckout(bookingId, http)).state).toBe("paid");
  });

  it("releases the tickets when the card is declined", async () => {
    const { bookingId } = await startSumUpCardSale(orgId, makeSale(), ACTOR, fakeSumUp(checkoutOk).http);
    const result = await settleSumUpCheckout(bookingId, fakeSumUp(txn("FAILED")).http);
    expect(result.state).toBe("failed");
    expect((await BookingModel.findById(bookingId))?.status).toBe("cancelled");
    expect((await EventModel.findById(eventId))?.soldGuestCount).toBe(0);
  });

  it("does not mark a sale paid when SumUp charged a different amount", async () => {
    const { bookingId } = await startSumUpCardSale(orgId, makeSale(), ACTOR, fakeSumUp(checkoutOk).http);
    const result = await settleSumUpCheckout(bookingId, fakeSumUp(txn("SUCCESSFUL", 200)).http);
    expect(result.state).toBe("mismatch");
    expect((await BookingModel.findById(bookingId))?.status).toBe("pending");
    expect(await VoucherModel.countDocuments({ bookingId })).toBe(0);
  });

  it("treats the webhook as a prompt to verify, never as proof", async () => {
    const { bookingId } = await startSumUpCardSale(orgId, makeSale(), ACTOR, fakeSumUp(checkoutOk).http);
    const token = (await BookingModel.findById(bookingId))!.cardCheckout!.webhookToken;

    await expect(handleSumUpWebhook("not-a-real-token")).rejects.toThrow(/Unknown/);
    // SumUp still says PENDING, so a webhook claiming success changes nothing.
    await handleSumUpWebhook(token, fakeSumUp(txn("PENDING")).http);
    expect((await BookingModel.findById(bookingId))?.status).toBe("pending");
    await handleSumUpWebhook(token, fakeSumUp(txn("SUCCESSFUL")).http);
    expect((await BookingModel.findById(bookingId))?.status).toBe("paid");
  });

  it("cancels a waiting sale by terminating the reader, unless the customer already paid", async () => {
    const { bookingId } = await startSumUpCardSale(orgId, makeSale(), ACTOR, fakeSumUp(checkoutOk).http);
    const cancel = fakeSumUp({
      "POST /v0.1/merchants/MH4H92C7/readers/rdr_1/terminate": () => ({ status: 200 }),
      ...txn("PENDING"),
    });
    expect((await cancelSumUpCardSale(orgId, bookingId, cancel.http)).state).toBe("cancelled");
    expect((await BookingModel.findById(bookingId))?.status).toBe("cancelled");

    const second = await startSumUpCardSale(orgId, makeSale(), ACTOR, fakeSumUp({ "POST /v0.1/merchants/MH4H92C7/readers/rdr_1/checkout": () => ({ status: 201, body: { data: { client_transaction_id: "ctx-1" } } }) }).http);
    const raced = fakeSumUp({ "POST /v0.1/merchants/MH4H92C7/readers/rdr_1/terminate": () => ({ status: 200 }), ...txn("SUCCESSFUL") });
    expect((await cancelSumUpCardSale(orgId, second.bookingId, raced.http)).state).toBe("paid");
  });

  it("refuses a reader that isn't this organization's", async () => {
    await expect(startSumUpCardSale(orgId, { ...makeSale(), readerId: "someone-elses" }, ACTOR, fakeSumUp({}).http)).rejects.toThrow(/paired readers/);
    expect(await BookingModel.countDocuments({})).toBe(0);
  });
});
