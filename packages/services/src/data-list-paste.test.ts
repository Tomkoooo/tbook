import { describe, expect, it } from "vitest";
import { parsePastedRows } from "./data-list-service";

const columns = [
  { key: "Dolgozó", label: "Dolgozó" },
  { key: "Név", label: "Név" },
  { key: "Vállalat", label: "Vállalat" },
];

describe("parsePastedRows", () => {
  it("splits Excel (tab) rows into the columns in order", () => {
    expect(parsePastedRows("16200150\tBodrogi Karolina\tEGDG\n60002482\tFerenczi Tamás", columns)).toEqual([
      { Dolgozó: "16200150", Név: "Bodrogi Karolina", Vállalat: "EGDG" },
      { Dolgozó: "60002482", Név: "Ferenczi Tamás", Vállalat: "" },
    ]);
  });
  it("skips a header line and blank lines, and reads ; or , separated text", () => {
    expect(parsePastedRows("Dolgozó;Név;Vállalat\n\n1;A;B\r\n", columns)).toEqual([{ Dolgozó: "1", Név: "A", Vállalat: "B" }]);
    expect(parsePastedRows("2,C", columns)).toEqual([{ Dolgozó: "2", Név: "C", Vállalat: "" }]);
  });
  it("takes a bare id per line", () => {
    expect(parsePastedRows("111\n222", columns).map((row) => row.Dolgozó)).toEqual(["111", "222"]);
  });
});
