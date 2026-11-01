import { MongoMemoryServer } from "mongodb-memory-server";
import { PDFDocument } from "pdf-lib";
import { dbConnect, dbDisconnectAll } from "@tbook/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_VOUCHER_PDF_LAYOUT } from "@tbook/schemas";
import { assertLayoutImages, readVoucherPdfAsset, storeVoucherPdfAsset, withAllowedImages } from "./voucher-pdf-assets";
import { buildVoucherPdf, resolveVoucherImage, type VoucherPdfPageInput } from "./voucher-pdf";

// 1×1 transparent PNG.
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));

const orgA = "a".repeat(24);
const orgB = "b".repeat(24);

function pageInput(overrides: Partial<VoucherPdfPageInput> = {}): VoucherPdfPageInput {
  return {
    token: "550e8400-e29b-41d4-a716-446655440000",
    displayName: "Kovács Anna",
    attendeeFields: {},
    attendeeFieldSchema: [],
    eventName: "Open",
    startDate: new Date("2026-07-11T00:00:00.000Z"),
    endDate: new Date("2026-07-11T00:00:00.000Z"),
    locationAddress: "Budapest",
    bookingId: "6a509cc69e04703ce2c58c27",
    validDate: "2026-07-11",
    ...overrides,
  };
}

describe("voucher PDF assets (database blob store)", () => {
  let mongod: MongoMemoryServer;
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
  });
  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });

  it("stores a PNG under the organization and only lets that organization read it back", async () => {
    const { url } = await storeVoucherPdfAsset(orgA, PNG);
    expect(url).toMatch(/^\/media\/[a-f0-9]{64}\.png$/);
    expect((await readVoucherPdfAsset(orgA, url))?.contentType).toBe("image/png");
    expect(await readVoucherPdfAsset(orgB, url)).toBeNull();
  });

  it("rejects files that are not PNG/JPEG, however they are named", async () => {
    await expect(storeVoucherPdfAsset(orgA, new TextEncoder().encode("<svg onload=alert(1)>"))).rejects.toThrow(/PNG or JPEG/);
    await expect(storeVoucherPdfAsset(orgA, new Uint8Array(0))).rejects.toThrow(/Choose an image/);
  });

  it("refuses a layout that points at another organization's files or the server's other folders", async () => {
    const { url } = await storeVoucherPdfAsset(orgA, PNG);
    const layoutWith = (src: string) => ({ ...DEFAULT_VOUCHER_PDF_LAYOUT, blocks: [...DEFAULT_VOUCHER_PDF_LAYOUT.blocks, { id: "i", type: "image" as const, enabled: true, src }] });

    await expect(assertLayoutImages(orgA, layoutWith(url))).resolves.toBeUndefined();
    await expect(assertLayoutImages(orgA, layoutWith("https://example.com/logo.png"))).resolves.toBeUndefined();
    await expect(assertLayoutImages(orgB, layoutWith(url))).rejects.toThrow();
    await expect(assertLayoutImages(orgA, layoutWith("/uploads/invoices/secret.pdf"))).rejects.toThrow();
    await expect(assertLayoutImages(orgA, layoutWith(`/uploads/ticket-assets/${orgA}/../${orgB}/x.png`))).rejects.toThrow();
    expect(withAllowedImages(orgA, layoutWith("/uploads/invoices/secret.pdf")).blocks.at(-1)?.src).toBe("");
    // Another organization's upload is never read, even if a layout names it.
    expect(await resolveVoucherImage(url, orgB)).toBeNull();
    expect(await resolveVoucherImage(url, null)).toBeNull();
  });

  it("draws uploaded pictures, a background and merge fields into the PDF", async () => {
    const { url } = await storeVoucherPdfAsset(orgA, PNG);
    expect(await resolveVoucherImage(url, orgA)).toMatchObject({ isPng: true });

    const layout = {
      ...DEFAULT_VOUCHER_PDF_LAYOUT,
      pageSize: "a5" as const,
      backgroundColor: "#f3f4f6",
      backgroundImage: url,
      borderColor: "#111827",
      borderWidth: 2,
      blocks: [
        { id: "logo", type: "image" as const, enabled: true, src: url, height: 40, align: "center" as const },
        ...DEFAULT_VOUCHER_PDF_LAYOUT.blocks,
        { id: "t", type: "customText" as const, enabled: true, bold: true, text: "Hello {{attendeeName}}\nPass for {{validDate}}" },
      ],
    };
    const bytes = await buildVoucherPdf({ pages: [pageInput()], layout, loadImage: (src) => resolveVoucherImage(src, orgA) });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(Math.round(doc.getPage(0).getWidth())).toBe(420);
  });
});
