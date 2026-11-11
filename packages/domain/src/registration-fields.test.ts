import { describe, expect, it } from "vitest";
import { matchesRuleConfig, collectListLookups, validateEligibility } from "./eligibility";
import {
  formatRegistrationNumber,
  isCheckboxChecked,
  isFieldVisible,
  normalizeListKey,
  normalizeRegistrationNumber,
  normalizeUniqueValue,
} from "./registration-fields";

describe("registration field helpers", () => {
  it("reads checkbox values from forms, JSON and spreadsheets", () => {
    for (const v of [true, "true", "1", "on", "Igen", "x"]) expect(isCheckboxChecked(v as never)).toBe(true);
    for (const v of [false, "", "false", "0", "nem", null, undefined]) expect(isCheckboxChecked(v as never)).toBe(false);
  });

  it("shows a conditional field only when its condition holds", () => {
    const field = { showWhen: { fieldKey: "transfer", values: ["igen"] } };
    expect(isFieldVisible(field, { transfer: "Igen" })).toBe(true);
    expect(isFieldVisible(field, { transfer: "nem" })).toBe(false);
    expect(isFieldVisible(field, {})).toBe(false);
    expect(isFieldVisible({}, {})).toBe(true);
  });

  it("normalises list keys per mode, including spreadsheet floats", () => {
    expect(normalizeListKey(60000001)).toBe("60000001");
    expect(normalizeListKey("60000001.0", "digits_only")).toBe("60000001");
    expect(normalizeListKey(" 6000-0001 ", "digits_only")).toBe("60000001");
    expect(normalizeListKey("AB 12", "alnum")).toBe("ab12");
    expect(normalizeListKey("  Szőke  Tibor ")).toBe("szőke tibor");
  });

  it("normalises unique values ignoring case, spaces and dashes", () => {
    expect(normalizeUniqueValue(" 6000-0001 ")).toBe(normalizeUniqueValue("60000001"));
    expect(normalizeUniqueValue("ab C")).toBe("abc");
  });

  it("formats and re-reads registration numbers, forgiving look-alike characters", () => {
    const code = formatRegistrationNumber(new Uint8Array([0, 1, 2, 3, 31, 30, 29, 28]));
    expect(code).toBe("0123-ZYXW");
    expect(normalizeRegistrationNumber("0123zyxw")).toBe("0123-ZYXW");
    expect(normalizeRegistrationNumber("O123-ZYXW")).toBe("0123-ZYXW");
    expect(normalizeRegistrationNumber("ABC")).toBe("");
    expect(normalizeRegistrationNumber("ABCD-EFGU")).toBe("");
  });
});

describe("in_list rules", () => {
  const event = { eligibilityPreset: "form_rules", eligibilityFormRules: { logic: "and" as const, rules: [{ id: "r", fieldKey: "id", op: "in_list" as const, value: "L1", message: "Unknown" }] } };
  const schema = [{ key: "id", label: "ID", type: "text" as const, required: true, helpText: "", sortOrder: 0 }];

  it("asks for exactly the submitted values", () => {
    expect(collectListLookups(event, [{ fields: { id: "1" } }, { fields: { id: "2" } }])).toEqual([
      { listId: "L1", value: "1" },
      { listId: "L1", value: "2" },
    ]);
  });

  it("passes members and fails everyone else; without membership it fails closed", () => {
    const membership = (listId: string, value: string) => listId === "L1" && value === "1";
    expect(validateEligibility(event, [{ fields: { id: "1" } }], schema, [], null, { listMembership: membership })).toEqual([]);
    expect(validateEligibility(event, [{ fields: { id: "2" } }], schema, [], null, { listMembership: membership })).toHaveLength(1);
    expect(validateEligibility(event, [{ fields: { id: "1" } }], schema, [], null)).toHaveLength(1);
  });

  it("matches one attendee against a rule set (used for email conditions)", () => {
    const config = { logic: "and" as const, rules: [{ id: "c", fieldKey: "transfer", op: "equals" as const, value: "igen" }] };
    expect(matchesRuleConfig(config, { transfer: "igen" }, [])).toBe(true);
    expect(matchesRuleConfig(config, { transfer: "nem" }, [])).toBe(false);
    expect(matchesRuleConfig(null, {}, [])).toBe(true);
  });
});
