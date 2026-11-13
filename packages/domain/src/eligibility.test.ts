import type { AttendeeFieldDef, BookingAttendee } from "@tbook/schemas";
import { describe, expect, it } from "vitest";
import { canonicalizeGenderValue, expandLegacyEligibilityForEdit, isEligibilityMatchOp, matchesRuleConfig, validateEligibility } from "./eligibility";

describe("expandLegacyEligibilityForEdit", () => {
  it("expands the legacy under18 preset into a custom max age", () => {
    expect(expandLegacyEligibilityForEdit({ eligibilityPreset: "under18" })).toEqual({
      eligibilityPreset: "custom",
      eligibilityMinAge: null,
      eligibilityMaxAge: 17,
      eligibilityAllowedGenders: null,
    });
  });

  it("expands the legacy women preset into min age + gender", () => {
    expect(expandLegacyEligibilityForEdit({ eligibilityPreset: "women" })).toEqual({
      eligibilityPreset: "custom",
      eligibilityMinAge: 18,
      eligibilityMaxAge: null,
      eligibilityAllowedGenders: ["female"],
    });
  });

  it("passes modern presets through unchanged", () => {
    expect(expandLegacyEligibilityForEdit({ eligibilityPreset: "none" }).eligibilityPreset).toBe("none");
  });
});

describe("canonicalizeGenderValue", () => {
  it("maps display labels to stable keys", () => {
    expect(canonicalizeGenderValue("Nő")).toBe("female");
    expect(canonicalizeGenderValue("Férfi")).toBe("male");
  });
});

const birthDateField: AttendeeFieldDef = { key: "birth_date", label: "Birth date", type: "date", required: true, helpText: "", sortOrder: 0 };

describe("validateEligibility", () => {
  it("returns no issues when the event has no eligibility rules", () => {
    const attendees: BookingAttendee[] = [{ fields: {} }];
    expect(validateEligibility({ eligibilityPreset: "none" }, attendees, [birthDateField], [], null)).toEqual([]);
  });

  it("flags a missing birth date when a min age is required", () => {
    const attendees: BookingAttendee[] = [{ fields: {} }];
    const issues = validateEligibility({ eligibilityPreset: "custom", eligibilityMinAge: 18 }, attendees, [birthDateField], [], null);
    expect(issues).toEqual([{ ticketIndex: 0, playerIndex: null, reason: "birth_date_required" }]);
  });

  it("flags an attendee below the minimum age", () => {
    const tooYoung = new Date();
    tooYoung.setFullYear(tooYoung.getFullYear() - 10);
    const attendees: BookingAttendee[] = [{ fields: { birth_date: tooYoung.toISOString() } }];
    const issues = validateEligibility({ eligibilityPreset: "custom", eligibilityMinAge: 18 }, attendees, [birthDateField], [], null);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.reason).toBe("min_age");
  });

  it("passes an attendee who meets the age requirement", () => {
    const oldEnough = new Date();
    oldEnough.setFullYear(oldEnough.getFullYear() - 25);
    const attendees: BookingAttendee[] = [{ fields: { birth_date: oldEnough.toISOString() } }];
    const issues = validateEligibility({ eligibilityPreset: "custom", eligibilityMinAge: 18 }, attendees, [birthDateField], [], null);
    expect(issues).toEqual([]);
  });

  it("evaluates form_rules with OR logic", () => {
    const genderField: AttendeeFieldDef = { key: "gender", label: "Gender", type: "select", required: true, helpText: "", sortOrder: 0, choices: [{ value: "female", label: "Female" }, { value: "male", label: "Male" }] };
    const event = {
      eligibilityPreset: "form_rules" as const,
      eligibilityFormRules: { logic: "or" as const, rules: [{ id: "r1", fieldKey: "gender", op: "equals" as const, value: "female", message: "Female only" }] },
    };
    const failing: BookingAttendee[] = [{ fields: { gender: "male" } }];
    const passing: BookingAttendee[] = [{ fields: { gender: "female" } }];
    expect(validateEligibility(event, failing, [genderField], [], null)[0]?.reason).toBe("form_rules_failed");
    expect(validateEligibility(event, passing, [genderField], [], null)).toEqual([]);
  });
});

describe("is_empty / is_not_empty (email conditions such as \"bus not chosen yet\")", () => {
  const schema: AttendeeFieldDef[] = [
    { key: "transzfer", label: "Transzfer", type: "select", required: true, choices: [{ value: "igen", label: "Igen" }, { value: "nem", label: "Nem" }] },
    { key: "busz", label: "Busz", type: "select", required: true, choicesSource: "bus-transport:routes", showWhen: { fieldKey: "transzfer", values: ["igen"] } },
  ] as AttendeeFieldDef[];
  const busEmpty = { logic: "and" as const, rules: [{ id: "c1", fieldKey: "busz", op: "is_empty" as const, value: "" }] };
  const awaitingBus = { logic: "and" as const, rules: [{ id: "c1", fieldKey: "transzfer", op: "equals" as const, value: "igen" }, { id: "c2", fieldKey: "busz", op: "is_empty" as const, value: "" }] };
  const busBooked = {
    logic: "and" as const,
    rules: [
      { id: "c1", fieldKey: "busz", op: "is_not_empty" as const, value: "" },
      { id: "c2", fieldKey: "busz", op: "not_equals" as const, value: "waitlist" },
    ],
  };

  it("matches a missing, empty or blank answer as empty and ignores the value", () => {
    expect(matchesRuleConfig(busEmpty, {}, schema)).toBe(true);
    expect(matchesRuleConfig(busEmpty, { busz: "" }, schema)).toBe(true);
    expect(matchesRuleConfig(busEmpty, { busz: "  " }, schema)).toBe(true);
    expect(matchesRuleConfig(busEmpty, { busz: "64f0c0ffee" }, schema)).toBe(false);
    expect(matchesRuleConfig({ logic: "and", rules: [{ id: "c1", fieldKey: "busz", op: "is_empty", value: "ignored" }] }, {}, schema)).toBe(true);
  });

  it("separates booked, waiting and not-chosen guests", () => {
    expect(matchesRuleConfig(busBooked, { transzfer: "igen", busz: "64f0c0ffee" }, schema)).toBe(true);
    expect(matchesRuleConfig(busBooked, { transzfer: "igen", busz: "waitlist" }, schema)).toBe(false);
    expect(matchesRuleConfig(busBooked, { transzfer: "igen" }, schema)).toBe(false);
    expect(matchesRuleConfig(awaitingBus, { transzfer: "igen" }, schema)).toBe(true);
    expect(matchesRuleConfig(awaitingBus, { transzfer: "nem" }, schema)).toBe(false);
    expect(matchesRuleConfig(awaitingBus, { transzfer: "igen", busz: "64f0c0ffee" }, schema)).toBe(false);
  });

  it("works as a registration rule too, and is a known op", () => {
    const event = { eligibilityPreset: "form_rules", eligibilityFormRules: { logic: "and" as const, rules: [{ id: "r1", fieldKey: "busz", op: "is_not_empty" as const, value: "" }] } };
    expect(validateEligibility(event, [{ fields: { busz: "x" } }], schema, [], null)).toEqual([]);
    expect(validateEligibility(event, [{ fields: {} }], schema, [], null)[0]?.reason).toBe("form_rules_failed");
    expect(isEligibilityMatchOp("is_empty")).toBe(true);
    expect(isEligibilityMatchOp("is_not_empty")).toBe(true);
    expect(isEligibilityMatchOp("empty")).toBe(false);
  });
});
