import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptOrgSecret, encryptOrgSecret, maskSecret, orgSecretLooksEncrypted } from "./org-secrets";

describe("org-secrets", () => {
  const originalKey = process.env.TBOOK_ORG_SECRETS_KEY;

  beforeEach(() => {
    process.env.TBOOK_ORG_SECRETS_KEY = "test-key-material";
  });

  afterEach(() => {
    process.env.TBOOK_ORG_SECRETS_KEY = originalKey;
  });

  it("round-trips a secret", () => {
    const enc = encryptOrgSecret("sk_live_abc123");
    expect(enc.startsWith("enc:v1:")).toBe(true);
    expect(decryptOrgSecret(enc)).toBe("sk_live_abc123");
  });

  it("returns empty string for an empty plaintext", () => {
    expect(encryptOrgSecret("")).toBe("");
    expect(decryptOrgSecret(null)).toBe("");
    expect(decryptOrgSecret(undefined)).toBe("");
  });

  it("is idempotent when encrypting an already-encrypted value", () => {
    const enc = encryptOrgSecret("secret");
    expect(encryptOrgSecret(enc)).toBe(enc);
  });

  it("falls back across key rotations", () => {
    const enc = encryptOrgSecret("rotated-secret");
    process.env.TBOOK_ORG_SECRETS_KEY = "a-different-key";
    // AUTH_SECRET / dev fallback won't match either — decrypt should fail closed, not throw.
    expect(decryptOrgSecret(enc)).toBe("");
  });

  it("detects encrypted-looking values", () => {
    expect(orgSecretLooksEncrypted(encryptOrgSecret("x"))).toBe(true);
    expect(orgSecretLooksEncrypted("plain-value")).toBe(false);
  });

  it("masks a configured secret without leaking it fully", () => {
    const enc = encryptOrgSecret("sk_live_1234567890");
    const masked = maskSecret(enc);
    expect(masked.configured).toBe(true);
    expect(masked.hint).not.toContain("1234567890");
  });

  it("reports not configured for an empty secret", () => {
    expect(maskSecret("")).toEqual({ configured: false, hint: "" });
  });
});
