import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";
import { PDFDocument } from "pdf-lib";
import { BookingModel, EventModel, OrganizationModel, VoucherModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MailTransporter } from "./mailer";
import { loadDefaultVoucherFont } from "./voucher-pdf";
import { sendBookingEmail } from "./booking-email";
import { encryptOrgSecret } from "./org-secrets";
import { renderVoucherPdfForBooking } from "./voucher-pdf-email";
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

describe("ticket PDF + booking email", () => {
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

  it("renders the ticket on demand, stores nothing, and emails it in the booking email", async () => {
    const event = await createEvent();
    const booking = await createPaidBooking(String(event._id));
    await issueVoucherRowsForBooking(String(booking._id));

    const sendMailMock = vi.fn().mockResolvedValue({ messageId: "1" });
    const transporter: MailTransporter = { sendMail: sendMailMock };
    process.env.EMAIL_HOST = "smtp.example.com";
    process.env.EMAIL_USER = "noreply@example.com";
    process.env.EMAIL_PASS = "secret";
    process.env.EMAIL_FROM = "noreply@example.com";

    const result = await sendBookingEmail(String(booking._id), { loadFont: async () => fontBytes, transporter });
    expect(result?.ticketCount).toBe(2);

    const attached = sendMailMock.mock.calls[0]![0].attachments[0].content as Buffer;
    expect((await PDFDocument.load(attached)).getPageCount()).toBe(2); // one page per guest
    expect(await readdir(uploadsDir)).toEqual([]); // nothing written to disk

    const vouchers = await VoucherModel.find({ bookingId: booking._id }).exec();
    expect(vouchers.every((v) => v.pdfFileName == null)).toBe(true);
    expect(vouchers.every((v) => v.emailedAt != null)).toBe(true);
    expect(vouchers.every((v) => v.lastSentToEmail === "anna@example.com")).toBe(true);

    expect(sendMailMock).toHaveBeenCalledOnce();
    const mailCall = sendMailMock.mock.calls[0]![0];
    expect(mailCall.to).toBe("anna@example.com");
    expect(mailCall.attachments).toHaveLength(1);
    expect(mailCall.attachments[0].contentType).toBe("application/pdf");
    // Default template, filled in.
    expect(mailCall.subject).toBe("Your booking for Első WDF verseny");
    expect(mailCall.html).toContain("Kovács Anna");
    expect(mailCall.html).toContain("your 2 tickets");
    expect(mailCall.html).not.toMatch(/\{\{/);

    await cleanupUploads();
  });

  it("attaches a legacy invoice file to the same single email and fills the org's template", async () => {
    const event = await createEvent();
    const org = await OrganizationModel.create({
      name: "MDSZ",
      slug: "mdsz",
      settings: {
        currency: "HUF",
        emailTemplates: {
          bookingConfirmation: { subject: "{{eventName}} – visszaigazolás", body: "<p>Kedves {{customerName}}! Csatolva: {{attachments}}.</p>" },
          voucherDelivery: { subject: "Legacy", body: "<p>Legacy</p>" },
        },
      },
    });
    const invoiceUrl = `/uploads/invoices/SZ-1.pdf`;
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(path.join(uploadsDir, "invoices"), { recursive: true });
    await writeFile(path.join(uploadsDir, "invoices", "SZ-1.pdf"), "%PDF-1.4 fake");
    const booking = await createPaidBooking(String(event._id), {
      organizationId: org._id,
      customer: { name: "<Anna>", email: "anna@example.com", phone: "+36301234567", note: "" },
      invoiceStatus: "issued",
      invoiceId: "SZ-1",
      invoicePdfFileName: invoiceUrl,
    });
    await issueVoucherRowsForBooking(String(booking._id));

    const sendMailMock = vi.fn().mockResolvedValue({ messageId: "1" });
    process.env.EMAIL_HOST = "smtp.example.com";
    process.env.EMAIL_USER = "noreply@example.com";
    process.env.EMAIL_PASS = "secret";

    const result = await sendBookingEmail(String(booking._id), { loadFont: async () => fontBytes, transporter: { sendMail: sendMailMock } });

    expect(result?.invoiceAttached).toBe(true);
    expect(sendMailMock).toHaveBeenCalledOnce();
    const mail = sendMailMock.mock.calls[0]![0];
    expect(mail.subject).toBe("Első WDF verseny – visszaigazolás");
    expect(mail.html).toBe("<p>Kedves &lt;Anna&gt;! Csatolva: your 2 tickets and your invoice.</p>");
    expect(mail.attachments.map((a: { filename: string }) => a.filename)).toEqual(["Els_WDF_verseny.pdf", "invoice-SZ-1.pdf"]);
    const reloaded = await BookingModel.findById(booking._id).exec();
    expect(reloaded?.invoiceEmailSentAt).toBeTruthy();

    await cleanupUploads();
  });

  it("downloads an issued Számlázz.hu invoice for the email when it isn't stored", async () => {
    const event = await createEvent();
    const org = await OrganizationModel.create({
      name: "MDSZ",
      slug: "mdsz-dl",
      settings: { currency: "HUF", szamlazz: { enabled: true, agentKeyEnc: encryptOrgSecret("agent-key") } },
    });
    const booking = await createPaidBooking(String(event._id), { organizationId: org._id, invoiceStatus: "issued", invoiceId: "SZ-77" });
    const invoiceProvider = { issueInvoice: vi.fn(), downloadInvoicePdf: vi.fn().mockResolvedValue(Buffer.from("%PDF-1.4 from szamlazz")) };
    const sendMailMock = vi.fn().mockResolvedValue({ messageId: "1" });
    process.env.EMAIL_HOST = "smtp.example.com";
    process.env.EMAIL_USER = "noreply@example.com";
    process.env.EMAIL_PASS = "secret";

    const result = await sendBookingEmail(String(booking._id), { loadFont: async () => fontBytes, transporter: { sendMail: sendMailMock }, invoiceProvider });

    expect(result?.invoiceAttached).toBe(true);
    expect(invoiceProvider.downloadInvoicePdf).toHaveBeenCalledWith({ agentKey: "agent-key", invoiceNumber: "SZ-77" });
    const files = sendMailMock.mock.calls[0]![0].attachments.map((a: { filename: string; content: Buffer }) => [a.filename, a.content.toString()]);
    expect(files).toEqual([["invoice-SZ-77.pdf", "%PDF-1.4 from szamlazz"]]);
    await cleanupUploads();
  });

  it("falls back to the legacy ticket template when no booking template is set", async () => {
    const event = await createEvent();
    const org = await OrganizationModel.create({
      name: "Old Org",
      slug: "old-org",
      settings: { currency: "HUF", emailTemplates: { voucherDelivery: { subject: "Your ticket", body: "<p>Old text</p>" } } },
    });
    const booking = await createPaidBooking(String(event._id), { organizationId: org._id });
    const sendMailMock = vi.fn().mockResolvedValue({ messageId: "1" });
    process.env.EMAIL_HOST = "smtp.example.com";
    process.env.EMAIL_USER = "noreply@example.com";
    process.env.EMAIL_PASS = "secret";

    // No vouchers issued: the confirmation still goes out, with nothing attached.
    await sendBookingEmail(String(booking._id), { loadFont: async () => fontBytes, transporter: { sendMail: sendMailMock } });

    const mail = sendMailMock.mock.calls[0]![0];
    expect(mail.subject).toBe("Your ticket");
    expect(mail.html).toBe("<p>Old text</p>");
    expect(mail.attachments).toEqual([]);
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

    const result = await sendBookingEmail(String(booking._id), { loadFont: async () => fontBytes, transporter: { sendMail: sendMailMock } });
    expect(result?.ticketCount).toBe(1);
    const attached = sendMailMock.mock.calls[0]![0].attachments[0].content as Buffer;
    expect((await PDFDocument.load(attached)).getPageCount()).toBe(1);

    await cleanupUploads();
  });

  it("renders no ticket PDF when the booking has no vouchers", async () => {
    const event = await createEvent();
    const booking = await createPaidBooking(String(event._id));
    // Deliberately skip issueVoucherRowsForBooking.
    expect(await renderVoucherPdfForBooking(String(booking._id), { loadFont: async () => fontBytes })).toBeNull();
    await cleanupUploads();
  });
});
