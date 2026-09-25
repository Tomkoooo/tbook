import { describe, expect, it } from "vitest";
import { parseBootstrapAdminEmails } from "./bootstrap-admin";

describe("parseBootstrapAdminEmails", () => {
  it("splits on commas, semicolons, and newlines", () => {
    expect(parseBootstrapAdminEmails("a@x.com,b@x.com;c@x.com\nd@x.com")).toEqual(["a@x.com", "b@x.com", "c@x.com", "d@x.com"]);
  });

  it("lowercases, trims, and dedupes", () => {
    expect(parseBootstrapAdminEmails(" A@X.com , a@x.com ")).toEqual(["a@x.com"]);
  });

  it("returns an empty array for undefined/blank input", () => {
    expect(parseBootstrapAdminEmails(undefined)).toEqual([]);
    expect(parseBootstrapAdminEmails("   ")).toEqual([]);
  });
});
