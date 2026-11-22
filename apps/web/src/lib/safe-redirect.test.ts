import { describe, expect, it } from "vitest";
import { safeRelativePath } from "./safe-redirect";

describe("safeRelativePath", () => {
  it("keeps same-origin relative paths, with query and hash", () => {
    expect(safeRelativePath("/")).toBe("/");
    expect(safeRelativePath("/admin")).toBe("/admin");
    expect(safeRelativePath("/admin/events/abc?tab=1#x", "/")).toBe("/admin/events/abc?tab=1#x");
    expect(safeRelativePath("/auth/qr/confirm?token=a%2Fb")).toBe("/auth/qr/confirm?token=a%2Fb");
  });

  it("falls back for missing or empty input", () => {
    expect(safeRelativePath(undefined, "/admin")).toBe("/admin");
    expect(safeRelativePath(null, "/admin")).toBe("/admin");
    expect(safeRelativePath("", "/admin")).toBe("/admin");
  });

  it("rejects absolute urls and schemes", () => {
    for (const bad of ["https://evil.com", "http://evil.com/admin", "javascript:alert(1)", "data:text/html,x", "evil.com", "admin"]) {
      expect(safeRelativePath(bad, "/x")).toBe("/x");
    }
  });

  it("rejects protocol-relative and backslash tricks", () => {
    for (const bad of ["//evil.com", "///evil.com", "/\\evil.com", "\\\\evil.com", "/\\/evil.com", "/admin\\..\\x"]) {
      expect(safeRelativePath(bad, "/x")).toBe("/x");
    }
  });

  it("rejects control characters the URL parser would strip", () => {
    expect(safeRelativePath("/\t/evil.com", "/x")).toBe("/x");
    expect(safeRelativePath("/\n/evil.com", "/x")).toBe("/x");
    expect(safeRelativePath("/ok\r\nSet-Cookie: a=b", "/x")).toBe("/x");
  });

  it("takes the first value of a repeated query parameter", () => {
    expect(safeRelativePath(["/admin", "https://evil.com"], "/x")).toBe("/admin");
    expect(safeRelativePath(["https://evil.com"], "/x")).toBe("/x");
  });
});
