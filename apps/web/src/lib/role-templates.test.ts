import { describe, expect, it } from "vitest";
import { TBOOK_PERMISSIONS } from "@tbook/schemas";
import { ROLE_TEMPLATES } from "./role-templates";

describe("ROLE_TEMPLATES", () => {
  it("only names permissions that exist in the catalog", () => {
    for (const template of ROLE_TEMPLATES) {
      for (const permission of template.permissions) expect(TBOOK_PERMISSIONS).toContain(permission);
    }
  });

  it("has unique keys and names", () => {
    expect(new Set(ROLE_TEMPLATES.map((t) => t.key)).size).toBe(ROLE_TEMPLATES.length);
    expect(new Set(ROLE_TEMPLATES.map((t) => t.name)).size).toBe(ROLE_TEMPLATES.length);
  });

  it("offers a cashier (Pénztáros) who can sell but not manage", () => {
    const cashier = ROLE_TEMPLATES.find((t) => t.key === "cashier");
    expect(cashier?.name).toBe("Pénztáros");
    expect([...(cashier?.permissions ?? [])].sort()).toEqual(["booking:read", "event:read", "product:read", "sale:create", "voucher:read"]);
    expect(cashier?.permissions).not.toContain("booking:manage");
  });
});
