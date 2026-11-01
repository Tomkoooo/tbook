import { describe, expect, it } from "vitest";
import { buildReceiptXml, parseReceiptResponse, splitGross } from "./receipt-service";

describe("splitGross", () => {
  it("keeps HUF gross whole and net + VAT exactly equal to gross", () => {
    for (const gross of [1, 999, 2540, 10_000, 12_345]) {
      for (const vat of [0, 5, 18, 27]) {
        const { brutto, netto, afa } = splitGross(gross, vat, "HUF");
        expect(Number.isInteger(brutto)).toBe(true);
        expect(Math.round((netto + afa) * 100)).toBe(brutto * 100);
        expect(netto).toBe(Math.round(netto * 100) / 100);
      }
    }
    expect(splitGross(12_700, 27, "HUF")).toEqual({ brutto: 12_700, netto: 10_000, afa: 2_700 });
  });

  it("allows cents for EUR", () => {
    expect(splitGross(12.34, 27, "EUR").brutto).toBe(12.34);
  });
});

describe("buildReceiptXml", () => {
  const xml = buildReceiptXml({
    agentKey: "key&<1>",
    prefix: "NYGTA",
    template: "N",
    currency: "HUF",
    paymentMethod: "cash",
    callId: "tbook-abc",
    items: [{ label: "Belépő <felnőtt>", quantity: 1, unit: "db", vatPercent: 27, grossUnitPrice: 2540 }],
    note: "Open & Pairs",
  });

  it("escapes text and fills the header", () => {
    expect(xml).toContain("<szamlaagentkulcs>key&amp;&lt;1&gt;</szamlaagentkulcs>");
    expect(xml).toContain("<megnevezes>Belépő &lt;felnőtt&gt;</megnevezes>");
    expect(xml).toContain("<fizmod>készpénz</fizmod>");
    expect(xml).toContain("<pdfSablon>N</pdfSablon>");
    expect(xml).toContain("<hivasAzonosito>tbook-abc</hivasAzonosito>");
    expect(xml).toContain("<pdfLetoltes>true</pdfLetoltes>");
  });

  it("keeps Számlázz.hu's fixed element order", () => {
    const order = ["<hivasAzonosito>", "<elotag>", "<fizmod>", "<penznem>", "<megjegyzes>", "<pdfSablon>", "<tetelek>"];
    const positions = order.map((t) => xml.indexOf(t));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    const itemOrder = ["<megnevezes>", "<mennyiseg>", "<mennyisegiEgyseg>", "<nettoEgysegar>", "<afakulcs>", "<netto>", "<afa>", "<brutto>"];
    const itemPositions = itemOrder.map((t) => xml.indexOf(t));
    expect([...itemPositions].sort((a, b) => a - b)).toEqual(itemPositions);
  });
});

describe("parseReceiptResponse", () => {
  it("reads the number and the base64 PDF", () => {
    const pdf = Buffer.from("%PDF-1.4 receipt").toString("base64");
    const result = parseReceiptResponse(
      `<?xml version="1.0"?><xmlnyugtavalasz xmlns="http://www.szamlazz.hu/xmlnyugtavalasz"><sikeres>true</sikeres><nyugta><alap><nyugtaszam>NYGTA-2026-7</nyugtaszam></alap></nyugta><nyugtaPdf>${pdf}</nyugtaPdf></xmlnyugtavalasz>`,
    );
    expect(result.number).toBe("NYGTA-2026-7");
    expect(result.pdf?.toString()).toBe("%PDF-1.4 receipt");
  });

  it("turns errors into readable messages, with a specific one for a repeated call id", () => {
    expect(() => parseReceiptResponse("<x><sikeres>false</sikeres><hibakod>57</hibakod><hibauzenet>Hibás kulcs</hibauzenet></x>")).toThrow(
      "Számlázz.hu error 57: Hibás kulcs",
    );
    expect(() => parseReceiptResponse("<x><sikeres>false</sikeres><hibakod>338</hibakod><hibauzenet>dup</hibauzenet></x>")).toThrow(/already has a receipt/);
  });
});
