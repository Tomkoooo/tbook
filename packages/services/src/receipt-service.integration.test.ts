import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Types } from "mongoose";
import { BookingModel, EventGroupModel, EventModel, OrganizationModel, VoucherModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { WALK_IN_CUSTOMER_EMAIL } from "@tbook/schemas";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sendBookingEmail } from "./booking-email";
import { encryptOrgSecret } from "./org-secrets";
import { createPosSale } from "./pos-service";
import { getReceiptPdfForOrg, issueReceiptForBooking } from "./receipt-service";

const ACTOR = { userId: new Types.ObjectId().toHexString() };

describe("walk-in sales and receipts", () => {
  let mongod: MongoMemoryServer;
  let uploadsDir: string;
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
    uploadsDir = await mkdtemp(path.join(tmpdir(), "tbook-receipt-test-"));
    vi.stubEnv("UPLOADS_DIR", uploadsDir);

    const org = await OrganizationModel.create({ name: "Org", slug: "org", status: "active", settings: { currency: "HUF" } });
    orgId = String(org._id);
    const group = await EventGroupModel.create({ name: "G", organizationId: org._id, status: "active", apiKeyHash: "h", apiKeyHint: "x", apiKeyCreatedAt: new Date() });
    const day = 86_400_000;
    eventId = String(
      (
        await EventModel.create({
          groupId: group._id,
          organizationId: org._id,
          name: "Open",
          status: "active",
          startDate: new Date(Date.now() + day),
          endDate: new Date(Date.now() + 2 * day),
          ticketFeeHuf: 2540,
          ticketPriceBasis: "gross",
          ticketVatPercent: 27,
          vouchersEnabled: true,
          capacity: 10,
        })
      )._id,
    );
    return async () => {
      vi.unstubAllEnvs();
      await rm(uploadsDir, { recursive: true, force: true });
    };
  });

  async function enableSzamlazz(extra: Record<string, unknown> = {}) {
    await OrganizationModel.updateOne(
      { _id: orgId },
      { "settings.szamlazz": { enabled: true, agentKeyEnc: encryptOrgSecret("agent-key"), receiptPrefix: "TESZT", receiptTemplate: "N", ...extra } },
    );
  }

  it("records a walk-in sale with no contact details: no email, entries checked in, receipt attempted", async () => {
    // Számlázz.hu is off here, so the receipt fails cleanly without any network call.
    const sale = await createPosSale(orgId, { eventId, tickets: 2, delivery: "receipt", customer: {}, paymentMethod: "cash" }, ACTOR);

    expect(sale.delivery).toBe("receipt");
    expect(sale.vouchersIssued).toBe(2);
    expect(sale.invoiceStatus).toBe("none");
    expect(sale.receipt?.status).toBe("failed");
    expect(sale.receipt?.error).toMatch(/not enabled/);

    const booking = await BookingModel.findById(sale.bookingId).exec();
    expect(booking?.status).toBe("paid");
    expect(booking?.customer.email).toBe(WALK_IN_CUSTOMER_EMAIL);
    expect(booking?.customer.name).toBe("Walk-in customer");
    expect(booking?.billing ?? null).toBeNull();

    const vouchers = await VoucherModel.find({ bookingId: sale.bookingId }).exec();
    expect(vouchers.map((v) => v.status)).toEqual(["checked_in", "checked_in"]);
    expect(vouchers.every((v) => v.emailedAt == null)).toBe(true);
  });

  it("still requires contact and billing details for an emailed sale", async () => {
    await expect(createPosSale(orgId, { eventId, tickets: 1, delivery: "email", customer: {}, paymentMethod: "cash" }, ACTOR)).rejects.toThrow(
      /Billing details/,
    );
  });

  it("issues the receipt once with the org's prefix, template and payment method, and prints the just-issued PDF", async () => {
    const sale = await createPosSale(orgId, { eventId, tickets: 2, delivery: "receipt", customer: { name: "Anna" }, paymentMethod: "card" }, ACTOR);
    await enableSzamlazz();

    const provider = {
      createReceipt: vi.fn().mockResolvedValue({ number: "TESZT-2026-1", pdf: Buffer.from("%PDF receipt") }),
      downloadReceiptPdf: vi.fn(),
    };
    await issueReceiptForBooking(sale.bookingId, { provider });
    await issueReceiptForBooking(sale.bookingId, { provider }); // idempotent

    expect(provider.createReceipt).toHaveBeenCalledOnce();
    const request = provider.createReceipt.mock.calls[0]![0];
    expect(request).toMatchObject({ prefix: "TESZT", template: "N", currency: "HUF", paymentMethod: "card", callId: `tbook-${sale.bookingId}` });
    expect(request.items.reduce((sum: number, item: { grossUnitPrice: number }) => sum + item.grossUnitPrice, 0)).toBe(5080);

    const served = await getReceiptPdfForOrg(orgId, sale.bookingId, provider);
    expect(served?.number).toBe("TESZT-2026-1");
    expect(served?.pdf.toString()).toBe("%PDF receipt");
    expect(provider.downloadReceiptPdf).not.toHaveBeenCalled(); // printed from the just-issued copy
    expect((await BookingModel.findById(sale.bookingId).exec())?.receipt?.pdfFileName ?? null).toBeNull(); // nothing stored
    await expect(getReceiptPdfForOrg(new Types.ObjectId().toHexString(), sale.bookingId)).rejects.toThrow(/not found/i);
  });

  it("reprints by downloading the receipt from Számlázz.hu, and reports when that fails", async () => {
    const sale = await createPosSale(orgId, { eventId, tickets: 1, delivery: "receipt", customer: {}, paymentMethod: "cash" }, ACTOR);
    await enableSzamlazz();
    // Számlázz.hu sent no PDF on creation, so nothing is held in memory.
    const provider = {
      createReceipt: vi.fn().mockResolvedValue({ number: "TESZT-2026-2", pdf: null }),
      downloadReceiptPdf: vi.fn().mockResolvedValue(Buffer.from("%PDF reprint")),
    };
    await issueReceiptForBooking(sale.bookingId, { provider });

    const served = await getReceiptPdfForOrg(orgId, sale.bookingId, provider);
    expect(served?.pdf.toString()).toBe("%PDF reprint");
    expect(provider.downloadReceiptPdf).toHaveBeenCalledWith({ agentKey: "agent-key", number: "TESZT-2026-2", template: "N" });

    const down = { createReceipt: vi.fn(), downloadReceiptPdf: vi.fn().mockRejectedValue(new Error("timeout")) };
    await BookingModel.updateOne({ _id: sale.bookingId }, { "receipt.number": "TESZT-2026-3" });
    await expect(getReceiptPdfForOrg(orgId, sale.bookingId, down)).rejects.toMatchObject({ code: "receipt_unavailable" });
  });

  it("records a provider failure so the seller can retry", async () => {
    const sale = await createPosSale(orgId, { eventId, tickets: 1, delivery: "receipt", customer: {}, paymentMethod: "cash" }, ACTOR);
    await enableSzamlazz();
    await issueReceiptForBooking(sale.bookingId, { provider: { createReceipt: vi.fn().mockRejectedValue(new Error("Számlázz.hu error 57: Hibás kulcs")), downloadReceiptPdf: vi.fn() } });
    const booking = await BookingModel.findById(sale.bookingId).exec();
    expect(booking?.receipt?.status).toBe("failed");
    expect(booking?.receipt?.error).toBe("Számlázz.hu error 57: Hibás kulcs");
  });

  it("never emails the walk-in placeholder address", async () => {
    const sale = await createPosSale(orgId, { eventId, tickets: 1, delivery: "receipt", customer: {}, paymentMethod: "cash" }, ACTOR);
    const transporter = { sendMail: vi.fn() };
    await expect(sendBookingEmail(sale.bookingId, { transporter })).rejects.toThrow(/walk-in/);
    expect(transporter.sendMail).not.toHaveBeenCalled();
  });
});
