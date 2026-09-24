import { describe, expect, it } from "vitest";
import { extractApiKeyFromRequest, generateApiKey, hashApiKey, isValidTBookApiKeyFormat, verifyApiKey } from "./api-key";

describe("api-key", () => {
  it("generates a key that hashes and verifies round-trip", () => {
    const key = generateApiKey();
    expect(isValidTBookApiKeyFormat(key)).toBe(true);
    expect(verifyApiKey(key, hashApiKey(key))).toBe(true);
    expect(verifyApiKey("tbk_wrong", hashApiKey(key))).toBe(false);
  });

  describe("extractApiKeyFromRequest", () => {
    it("reads the X-TBook-Api-Key header", () => {
      const request = new Request("https://tbook.example.com/api/v1/events", { headers: { "X-TBook-Api-Key": "tbk_abc123" } });
      expect(extractApiKeyFromRequest(request)).toBe("tbk_abc123");
    });

    it("falls back to Authorization: Bearer", () => {
      const request = new Request("https://tbook.example.com/api/v1/events", { headers: { Authorization: "Bearer tbk_abc123" } });
      expect(extractApiKeyFromRequest(request)).toBe("tbk_abc123");
    });

    it("prefers the dedicated header over Authorization when both are present", () => {
      const request = new Request("https://tbook.example.com/api/v1/events", {
        headers: { "X-TBook-Api-Key": "tbk_header", Authorization: "Bearer tbk_bearer" },
      });
      expect(extractApiKeyFromRequest(request)).toBe("tbk_header");
    });

    it("returns null when neither header is present", () => {
      const request = new Request("https://tbook.example.com/api/v1/events");
      expect(extractApiKeyFromRequest(request)).toBeNull();
    });
  });
});
