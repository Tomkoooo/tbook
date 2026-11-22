import { describe, expect, it } from "vitest";
import { BOOKING_STATUS_TONES, TONE_CLASSES, toneFor } from "./status-tones";

describe("toneFor", () => {
  it("maps known statuses and falls back to neutral", () => {
    expect(toneFor(BOOKING_STATUS_TONES, "paid")).toBe("success");
    expect(toneFor(BOOKING_STATUS_TONES, "something-new")).toBe("neutral");
    expect(toneFor(BOOKING_STATUS_TONES, null)).toBe("neutral");
  });
});

describe("TONE_CLASSES", () => {
  it("defines every tone with all surfaces", () => {
    for (const tone of ["neutral", "info", "success", "warning", "danger", "note"] as const) {
      expect(Object.keys(TONE_CLASSES[tone]).sort()).toEqual(["border", "chip", "dot", "soft", "text"]);
    }
  });
});
