import { MongoMemoryServer } from "mongodb-memory-server";
import { BookingModel, EventModel, OrganizationModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptOrgSecret } from "./org-secrets";
import { getInvoicePdfForBooking, issueInvoiceForBooking, type SzamlazzInvoiceProvider } from "./invoice-service";

async function createOrg(overrides: Partial<Record<string, unknown>> = {}) {
  return OrganizationModel.create({
    name: "Magyar Darts Szövetség",
    slug: "magyar-darts-szovetseg",
    settings: {
      szamlazz: { enabled: true, agentKeyEnc: encryptOrgSecret("real-agent-key"), sellerName: "MDSZ", sellerBank: "", sellerBankAccount: "" },
    },
    ...overrides,
  });
}

async function createEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return EventModel.create({
    name: "Első WDF verseny",
    status: "active",
    startDate: new Date(),
    endDate: new Date(),
    ticketFeeHuf: 5000,
    ticketVatPercent: 27,
    ...overrides,
  });
}

async function createBooking(organizationId: string | null, eventId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return BookingModel.create({
    organizationId,
    eventId,
    eventName: "Első WDF verseny",
    groupName: "",
    hotelName: "",
    customer: { name: "Kovács Anna", email: "anna@example.com", phone: "+36301234567", note: "" },
    billing: { billingType: "personal", name: "Kovács Anna", zip: "1051", city: "Budapest", street: "Récsei Center", countryCode: "HU", taxNumber: "" },
    attendeeFieldSchema: [],
    guests: 1,
    nights: 0,
    playersPerTicket: 1,
    attendees: [{ fields: {} }],
    selections: {},
    quote: { guests: 1, nights: 0, ticketSubtotalHuf: 6350, accommodationBaseHuf: 0, accommodationOptionsHuf: 0, accommodationSubtotalHuf: 0, totalHuf: 6350, lines: [{ key: "ticket", label: "Entry", amountHuf: 6350 }] },
    totalHuf: 6350,
    currency: "HUF",
    status: "paid",
    ...overrides,
  });
}

function fakeProvider(overrides: Partial<SzamlazzInvoiceProvider> = {}): SzamlazzInvoiceProvider & { issueInvoice: ReturnType<typeof vi.fn> } {
  return {
    issueInvoice: vi.fn().mockResolvedValue({ invoiceId: "SZ-2026-001", pdfBuffer: null }),
    ...overrides,
  } as SzamlazzInvoiceProvider & { issueInvoice: ReturnType<typeof vi.fn> };
}

describe("issueInvoiceForBooking", () => {
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
    await Promise.all([OrganizationModel.deleteMany({}), EventModel.deleteMany({}), BookingModel.deleteMany({})]);
  });

  it("issues an invoice through the injected provider and updates the booking", async () => {
    const org = await createOrg();
    const event = await createEvent();
    const booking = await createBooking(String(org._id), String(event._id));
    const provider = fakeProvider();

    await issueInvoiceForBooking(String(booking._id), { provider });

    expect(provider.issueInvoice).toHaveBeenCalledOnce();
    const reloaded = await BookingModel.findById(booking._id).exec();
    expect(reloaded?.invoiceStatus).toBe("issued");
    expect(reloaded?.invoiceId).toBe("SZ-2026-001");
    expect(reloaded?.invoiceError).toBeNull();
  });

  it("is idempotent — an already-issued invoice is never re-issued", async () => {
    const org = await createOrg();
    const event = await createEvent();
    const booking = await createBooking(String(org._id), String(event._id), { invoiceStatus: "issued", invoiceId: "SZ-OLD" });
    const provider = fakeProvider();

    await issueInvoiceForBooking(String(booking._id), { provider });

    expect(provider.issueInvoice).not.toHaveBeenCalled();
    const reloaded = await BookingModel.findById(booking._id).exec();
    expect(reloaded?.invoiceId).toBe("SZ-OLD");
  });

  it("sets invoiceStatus=none when the org has Számlázz disabled (no retry needed)", async () => {
    const org = await createOrg({ settings: { szamlazz: { enabled: false } } });
    const event = await createEvent();
    const booking = await createBooking(String(org._id), String(event._id));

    await issueInvoiceForBooking(String(booking._id), { provider: fakeProvider() });

    const reloaded = await BookingModel.findById(booking._id).exec();
    expect(reloaded?.invoiceStatus).toBe("none");
  });

  it("sets invoiceStatus=failed for a booking with no organization", async () => {
    const event = await createEvent();
    const booking = await createBooking(null, String(event._id));

    await issueInvoiceForBooking(String(booking._id), { provider: fakeProvider() });

    const reloaded = await BookingModel.findById(booking._id).exec();
    expect(reloaded?.invoiceStatus).toBe("failed");
  });

  it("sets invoiceStatus=failed for an unsupported currency", async () => {
    const org = await createOrg();
    const event = await createEvent();
    const booking = await createBooking(String(org._id), String(event._id), { currency: "USD" });

    await issueInvoiceForBooking(String(booking._id), { provider: fakeProvider() });

    const reloaded = await BookingModel.findById(booking._id).exec();
    expect(reloaded?.invoiceStatus).toBe("failed");
    expect(reloaded?.invoiceError).toMatch(/HUF and EUR/);
  });

  it("sets invoiceStatus=failed when the booking has no billing address", async () => {
    const org = await createOrg();
    const event = await createEvent();
    const booking = await createBooking(String(org._id), String(event._id), { billing: null });

    await issueInvoiceForBooking(String(booking._id), { provider: fakeProvider() });

    const reloaded = await BookingModel.findById(booking._id).exec();
    expect(reloaded?.invoiceStatus).toBe("failed");
    expect(reloaded?.invoiceError).toMatch(/billing/i);
  });

  it("records the provider's error message and never throws when the API call fails", async () => {
    const org = await createOrg();
    const event = await createEvent();
    const booking = await createBooking(String(org._id), String(event._id));
    const provider = fakeProvider({ issueInvoice: vi.fn().mockRejectedValue(new Error("Számlázz.hu is down")) } as never);

    await expect(issueInvoiceForBooking(String(booking._id), { provider })).resolves.toBeNull();

    const reloaded = await BookingModel.findById(booking._id).exec();
    expect(reloaded?.invoiceStatus).toBe("failed");
    expect(reloaded?.invoiceError).toBe("Számlázz.hu is down");
  });

  it("resolves accommodation VAT from the hotel when the booking has one", async () => {
    const org = await createOrg();
    const event = await createEvent();
    const booking = await createBooking(String(org._id), String(event._id), {
      quote: { guests: 1, nights: 1, ticketSubtotalHuf: 6350, accommodationBaseHuf: 10_000, accommodationOptionsHuf: 0, accommodationSubtotalHuf: 10_000, totalHuf: 16_350, lines: [{ key: "ticket", label: "Entry", amountHuf: 6350 }, { key: "accommodation_base", label: "Room", amountHuf: 10_000 }] },
      totalHuf: 16_350,
    });
    const provider = fakeProvider();

    await issueInvoiceForBooking(String(booking._id), { provider });

    const call = provider.issueInvoice.mock.calls[0]?.[0];
    expect(call.items.find((i: { label: string }) => i.label === "Room").vatPercent).toBe(27); // no hotel linked -> falls back to ticket VAT
  });

  it("returns the PDF it was issued with, stores none, and downloads it from Számlázz.hu later", async () => {
    const org = await createOrg();
    const event = await createEvent();
    const booking = await createBooking(String(org._id), String(event._id));
    const pdf = Buffer.from("%PDF-1.4 issued");
    const provider = fakeProvider({
      issueInvoice: vi.fn().mockResolvedValue({ invoiceId: "SZ-2026-9", pdfBuffer: pdf }),
      downloadInvoicePdf: vi.fn().mockResolvedValue(Buffer.from("%PDF-1.4 downloaded")),
    } as never);

    expect(await issueInvoiceForBooking(String(booking._id), { provider })).toBe(pdf);
    const reloaded = await BookingModel.findById(booking._id).exec();
    expect(reloaded?.invoicePdfFileName ?? null).toBeNull();

    const downloaded = await getInvoicePdfForBooking(reloaded!, { provider });
    expect(downloaded?.toString()).toBe("%PDF-1.4 downloaded");
    expect(provider.downloadInvoicePdf).toHaveBeenCalledWith({ agentKey: expect.any(String), invoiceNumber: "SZ-2026-9" });
  });

  it("does not send its own email — the PDF travels in the booking email", async () => {
    const org = await createOrg();
    const event = await createEvent();
    const booking = await createBooking(String(org._id), String(event._id), { source: "pos", paymentMethod: "cash" });
    const provider = fakeProvider({
      issueInvoice: vi.fn().mockResolvedValue({ invoiceId: "SZ-2026-002", pdfBuffer: null }),
    } as never);

    await issueInvoiceForBooking(String(booking._id), { provider });

    expect(provider.issueInvoice.mock.calls[0]?.[0].paymentMethod).toBe("cash");
    const reloaded = await BookingModel.findById(booking._id).exec();
    expect(reloaded?.invoiceStatus).toBe("issued");
    expect(reloaded?.invoiceEmailSentAt).toBeNull();
  });
});
