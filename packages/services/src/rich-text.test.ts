import { describe, expect, it } from "vitest";
import { sanitizeRichText } from "./rich-text";

describe("sanitizeRichText", () => {
  it("keeps formatting and strips anything executable", () => {
    expect(sanitizeRichText('<p onclick="x()">Hi <strong>there</strong><script>alert(1)</script></p>')).toBe("<p>Hi <strong>there</strong></p>");
    expect(sanitizeRichText('<a href="javascript:alert(1)">x</a><a href="https://a.hu">y</a>')).toBe('<a rel="noopener noreferrer">x</a><a href="https://a.hu" rel="noopener noreferrer">y</a>');
    expect(sanitizeRichText('<img src=x onerror=alert(1)><iframe src="https://evil"></iframe><p style="color:red">ok</p>')).toBe("<p>ok</p>");
  });

  it("stores an empty editor as an empty string", () => {
    expect(sanitizeRichText("<p></p>")).toBe("");
    expect(sanitizeRichText("<p> </p><p></p>")).toBe("");
  });
});
