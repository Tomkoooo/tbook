import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { DEFAULT_VOUCHER_PDF_LAYOUT } from "@tbook/schemas";
import { buildVoucherPdf, loadDefaultVoucherFont, type VoucherPdfPageInput } from "./voucher-pdf";

function pageInput(overrides: Partial<VoucherPdfPageInput> = {}): VoucherPdfPageInput {
  return {
    token: "550e8400-e29b-41d4-a716-446655440000",
    displayName: "Kovács Anna",
    attendeeFields: {},
    attendeeFieldSchema: [],
    eventName: "Első WDF verseny",
    startDate: new Date("2026-07-11T00:00:00.000Z"),
    endDate: new Date("2026-07-12T00:00:00.000Z"),
    locationAddress: "1051 Budapest Récsei Center",
    bookingId: "6a509cc69e04703ce2c58c27",
    ...overrides,
  };
}

describe("buildVoucherPdf", () => {
  it("produces a valid multi-page PDF, one page per guest", async () => {
    const bytes = await buildVoucherPdf({
      pages: [pageInput(), pageInput({ displayName: "Kiss Béla" }), pageInput({ displayName: "Nagy Zoltán" })],
      layout: DEFAULT_VOUCHER_PDF_LAYOUT,
    });

    expect(Buffer.from(bytes.slice(0, 5)).toString("ascii")).toBe("%PDF-");
    const reparsed = await PDFDocument.load(bytes);
    expect(reparsed.getPageCount()).toBe(3);
  });

  it("renders a single-guest booking as a one-page PDF", async () => {
    const bytes = await buildVoucherPdf({ pages: [pageInput()], layout: DEFAULT_VOUCHER_PDF_LAYOUT });
    const reparsed = await PDFDocument.load(bytes);
    expect(reparsed.getPageCount()).toBe(1);
  });

  it("renders attendee field values, formatting select choices by label", async () => {
    const bytes = await buildVoucherPdf({
      pages: [
        pageInput({
          attendeeFieldSchema: [{ key: "size", label: "Póló méret", type: "select", required: false, helpText: "", sortOrder: 0, choices: [{ value: "m", label: "Medium" }] }],
          attendeeFields: { size: "m" },
        }),
      ],
      layout: DEFAULT_VOUCHER_PDF_LAYOUT,
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString("ascii")).toBe("%PDF-");
  });

  it("falls back to the default layout when null/undefined is passed", async () => {
    const bytes = await buildVoucherPdf({ pages: [pageInput()], layout: null });
    const reparsed = await PDFDocument.load(bytes);
    expect(reparsed.getPageCount()).toBe(1);
  });

  it("respects a fully admin-customized layout: disabled blocks, restyled title, added custom text", async () => {
    const bytes = await buildVoucherPdf({
      pages: [pageInput()],
      layout: {
        ...DEFAULT_VOUCHER_PDF_LAYOUT,
        primaryColor: "#ff00aa",
        blocks: [
          { id: "title", type: "title", enabled: true, fontSize: 28, color: "#ff00aa", align: "center" },
          { id: "location", type: "location", enabled: false },
          { id: "note", type: "customText", enabled: true, text: "Free drink included!", fontSize: 12, color: "#009900" },
          { id: "qr", type: "qrCode", enabled: true },
        ],
      },
    });
    const reparsed = await PDFDocument.load(bytes);
    expect(reparsed.getPageCount()).toBe(1);
  });

  it("supports an injected font loader (no filesystem access required)", async () => {
    const realFontBytes = await loadDefaultVoucherFont();
    let called = false;
    const bytes = await buildVoucherPdf({
      pages: [pageInput()],
      loadFont: async () => {
        called = true;
        return realFontBytes;
      },
    });
    expect(called).toBe(true);
    expect(Buffer.from(bytes.slice(0, 5)).toString("ascii")).toBe("%PDF-");
  });

  it("handles Hungarian double-acute-accent characters (ő/ű) without throwing", async () => {
    const bytes = await buildVoucherPdf({
      pages: [pageInput({ displayName: "Őrizze meg a QR kódot, kérjük!", eventName: "Vívőverseny" })],
      layout: DEFAULT_VOUCHER_PDF_LAYOUT,
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString("ascii")).toBe("%PDF-");
  });
});
