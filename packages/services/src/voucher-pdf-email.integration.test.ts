import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";
import { PDFDocument } from "pdf-lib";
import { BookingModel, EventModel, OrganizationModel, VoucherModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MailTransporter } from "./mailer";
import { loadDefaultVoucherFont } from "./voucher-pdf";
import { issueVoucherPdfAndEmail } from "./voucher-pdf-email";
import { issueVoucherRowsForBooking } from "./voucher-service";

async function createEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return EventModel.create({
    name: "Első WDF verseny",
    status: "active",
    startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    endDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    ticketFeeHuf: 5000,
    ticketFeeMode: "per_person",
    ticketPriceBasis: "gross",
    ticketVatPercent: 27,
    vouchersEnabled: true,
    ...overrides,
  });
}

async function createPaidBooking(eventId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return BookingModel.create({
    eventId,
    eventName: "Első WDF verseny",
    groupName: "",
    hotelName: "",
    customer: { name: "Kovács Anna", email: "anna@example.com", phone: "+36301234567", note: "" },
    attendeeFieldSchema: [],
    guests: 2,
    nights: 0,
    playersPerTicket: 1,
    attendees: [{ fields: {} }, { fields: {} }],
    selections: {},
    quote: { guests: 2, accommodationGuests: 0, nights: 0, ticketSubtotalHuf: 10_000, accommodationBaseHuf: 0, accommodationOptionsHuf: 0, accommodationSubtotalHuf: 0, totalHuf: 10_000, lines: [] },
    totalHuf: 10_000,
    currency: "HUF",
    status: "paid",
    ...overrides,
  });
}

describe("issueVoucherPdfAndEmail", () => {
  let mongod: MongoMemoryServer;
  let uploadsDir: string;
  let previousUploadsDir: string | undefined;
  let fontBytes: Uint8Array;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
    fontBytes = await loadDefaultVoucherFont();
  });

  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });

  beforeEach(async () => {
    await Promise.all([EventModel.deleteMany({}), BookingModel.deleteMany({}), VoucherModel.deleteMany({}), OrganizationModel.deleteMany({})]);
    previousUploadsDir = process.env.UPLOADS_DIR;
    uploadsDir = await mkdtemp(path.join(tmpdir(), "tbook-voucher-pdf-test-"));
    process.env.UPLOADS_DIR = uploadsDir;
  });

  async function cleanupUploads() {
    process.env.UPLOADS_DIR = previousUploadsDir;
    await rm(uploadsDir, { recursive: true, force: true });
  }

  it("renders, stores, stamps pdfFileName, and emails the voucher PDF", async () => {
    const event = await createEvent();
    const booking = await createPaidBooking(String(event._id));
    await issueVoucherRowsForBooking(String(booking._id));

    const sendMailMock = vi.fn().mockResolvedValue({ messageId: "1" });
    const transporter: MailTransporter = { sendMail: sendMailMock };
    process.env.EMAIL_HOST = "smtp.example.com";
    process.env.EMAIL_USER = "noreply@example.com";
    process.env.EMAIL_PASS = "secret";
    process.env.EMAIL_FROM = "noreply@example.com";

    const url = await issueVoucherPdfAndEmail(String(booking._id), { loadFont: async () => fontBytes, transporter });
    expect(url).toBe(`/uploads/vouchers/${booking._id}.pdf`);

    const filePath = path.join(uploadsDir, "vouchers", `${booking._id}.pdf`);
    const fileBytes = await readFile(filePath);
    const reparsed = await PDFDocument.load(fileBytes);
    expect(reparsed.getPageCount()).toBe(2); // one page per guest

    const vouchers = await VoucherModel.find({ bookingId: booking._id }).exec();
    expect(vouchers.every((v) => v.pdfFileName === url)).toBe(true);
    expect(vouchers.every((v) => v.emailedAt != null)).toBe(true);
    expect(vouchers.every((v) => v.lastSentToEmail === "anna@example.com")).toBe(true);

    expect(sendMailMock).toHaveBeenCalledOnce();
    const mailCall = sendMailMock.mock.calls[0]![0];
    expect(mailCall.to).toBe("anna@example.com");
    expect(mailCall.attachments).toHaveLength(1);
    expect(mailCall.attachments[0].contentType).toBe("application/pdf");

    await cleanupUploads();
  });

  it("uses the org's admin-customized layout when configured", async () => {
    const event = await createEvent();
    const org = await OrganizationModel.create({
      name: "Custom Org",
      slug: "custom-org",
      settings: {
        currency: "HUF",
        voucherPdfLayout: {
          margin: 48,
          headerHeight: 120,
          titleFontSize: 20,
          bodyFontSize: 11,
          primaryColor: "#ff00aa",
          showPageNumbers: true,
          blocks: [
            { id: "title", type: "title", enabled: true, color: "#ff00aa" },
            { id: "custom", type: "customText", enabled: true, text: "Sponsored by Acme Inc." },
            { id: "qr", type: "qrCode", enabled: true },
          ],
        },
      },
    });
    const booking = await createPaidBooking(String(event._id), { organizationId: org._id, guests: 1, attendees: [{ fields: {} }] });
    await issueVoucherRowsForBooking(String(booking._id));

    const sendMailMock = vi.fn().mockResolvedValue({ messageId: "1" });
    process.env.EMAIL_HOST = "smtp.example.com";
    process.env.EMAIL_USER = "noreply@example.com";
    process.env.EMAIL_PASS = "secret";
    process.env.EMAIL_FROM = "noreply@example.com";

    const url = await issueVoucherPdfAndEmail(String(booking._id), { loadFont: async () => fontBytes, transporter: { sendMail: sendMailMock } });
    expect(url).not.toBeNull();

    const filePath = path.join(uploadsDir, "vouchers", `${booking._id}.pdf`);
    const fileBytes = await readFile(filePath);
    const reparsed = await PDFDocument.load(fileBytes);
    expect(reparsed.getPageCount()).toBe(1);

    await cleanupUploads();
  });

  it("returns null and does nothing when the booking has no vouchers", async () => {
    const event = await createEvent();
    const booking = await createPaidBooking(String(event._id));
    // Deliberately skip issueVoucherRowsForBooking.
    expect(await issueVoucherPdfAndEmail(String(booking._id), { loadFont: async () => fontBytes })).toBeNull();
    await cleanupUploads();
  });
});
