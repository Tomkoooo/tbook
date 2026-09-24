import { describe, expect, it } from "vitest";
import { DEFAULT_VOUCHER_PDF_LAYOUT, normalizeVoucherPdfLayout, voucherPdfLayoutSchema } from "./voucher-pdf-layout";

describe("normalizeVoucherPdfLayout", () => {
  it("returns a copy of the default for null/undefined input", () => {
    expect(normalizeVoucherPdfLayout(null)).toEqual(DEFAULT_VOUCHER_PDF_LAYOUT);
    expect(normalizeVoucherPdfLayout(undefined)).toEqual(DEFAULT_VOUCHER_PDF_LAYOUT);
  });

  it("returns a copy of the default for non-object input (legacy junk data)", () => {
    expect(normalizeVoucherPdfLayout("not-a-layout")).toEqual(DEFAULT_VOUCHER_PDF_LAYOUT);
    expect(normalizeVoucherPdfLayout(42)).toEqual(DEFAULT_VOUCHER_PDF_LAYOUT);
  });

  it("falls back to the default per-field on a partial layout", () => {
    const result = normalizeVoucherPdfLayout({ primaryColor: "#ff0000" });
    expect(result.primaryColor).toBe("#ff0000");
    expect(result.margin).toBe(DEFAULT_VOUCHER_PDF_LAYOUT.margin);
    expect(result.blocks).toEqual(DEFAULT_VOUCHER_PDF_LAYOUT.blocks);
  });

  it("lets an admin disable a block, restyle it, and add a custom text block", () => {
    const custom = normalizeVoucherPdfLayout({
      blocks: [
        { id: "title", type: "title", enabled: true, fontSize: 30, color: "#0000ff", align: "center" },
        { id: "location", type: "location", enabled: false },
        { id: "extra", type: "customText", enabled: true, text: "Please arrive 30 minutes early.", fontSize: 10 },
        { id: "qr", type: "qrCode", enabled: true },
      ],
    });
    expect(custom.blocks).toHaveLength(4);
    expect(custom.blocks[0]).toMatchObject({ type: "title", fontSize: 30, color: "#0000ff", align: "center" });
    expect(custom.blocks[1]).toMatchObject({ type: "location", enabled: false });
    expect(custom.blocks[2]).toMatchObject({ type: "customText", text: "Please arrive 30 minutes early." });
  });

  it("drops malformed block entries but keeps the valid ones", () => {
    const result = normalizeVoucherPdfLayout({
      blocks: [
        { id: "ok", type: "title", enabled: true },
        { type: "title" }, // missing required id — dropped
        "not-an-object",
      ],
    });
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.id).toBe("ok");
  });

  it("falls back to the full default block list when every block is malformed", () => {
    const result = normalizeVoucherPdfLayout({ blocks: [{ bogus: true }] });
    expect(result.blocks).toEqual(DEFAULT_VOUCHER_PDF_LAYOUT.blocks);
  });
});

describe("voucherPdfLayoutSchema", () => {
  it("accepts the shipped default layout", () => {
    expect(voucherPdfLayoutSchema.safeParse(DEFAULT_VOUCHER_PDF_LAYOUT).success).toBe(true);
  });
});
