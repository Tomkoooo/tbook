import type { PricingRule } from "@tbook/schemas";
import { describe, expect, it } from "vitest";
import { applyPricingRuleAdjustments, resolveTicketFeeOverride, ruleMatches } from "./pricing-rules";

function rule(overrides: Partial<PricingRule>): PricingRule {
  return { id: "r1", enabled: true, label: "Rule", when: "always", action: "adjust_total", amount: 0, amountMode: "fixed", ...overrides };
}

describe("ruleMatches", () => {
  it("always matches", () => {
    expect(ruleMatches(rule({ when: "always" }), { hasHotel: false, hasPackage: false, guests: 1, accommodationGuests: 1, playersPerTicket: 1, ticketSubtotalHuf: 0, accommodationSubtotalHuf: 0 })).toBe(true);
  });

  it("with_hotel requires a hotel", () => {
    const ctx = { hasHotel: false, hasPackage: false, guests: 1, accommodationGuests: 1, playersPerTicket: 1, ticketSubtotalHuf: 0, accommodationSubtotalHuf: 0 };
    expect(ruleMatches(rule({ when: "with_hotel" }), ctx)).toBe(false);
    expect(ruleMatches(rule({ when: "with_hotel" }), { ...ctx, hasHotel: true })).toBe(true);
  });

  it("disabled rules never match", () => {
    expect(ruleMatches(rule({ when: "always", enabled: false }), { hasHotel: false, hasPackage: false, guests: 1, accommodationGuests: 1, playersPerTicket: 1, ticketSubtotalHuf: 0, accommodationSubtotalHuf: 0 })).toBe(false);
  });
});

describe("resolveTicketFeeOverride", () => {
  it("returns the free-entry override when the rule matches", () => {
    const rules = [rule({ when: "always", action: "set_ticket_fee", amount: 0 })];
    const override = resolveTicketFeeOverride(rules, { hasHotel: false, hasPackage: false, guests: 1, accommodationGuests: 1, playersPerTicket: 1 });
    expect(override).toBe(0);
  });

  it("returns null when no set_ticket_fee rule matches", () => {
    const rules = [rule({ when: "with_hotel", action: "set_ticket_fee", amount: 0 })];
    const override = resolveTicketFeeOverride(rules, { hasHotel: false, hasPackage: false, guests: 1, accommodationGuests: 1, playersPerTicket: 1 });
    expect(override).toBeNull();
  });
});

describe("applyPricingRuleAdjustments", () => {
  it("scales a per_person surcharge by guest count", () => {
    const rules = [rule({ when: "without_hotel", action: "adjust_total", amount: 100, amountMode: "per_person" })];
    const lines = applyPricingRuleAdjustments(rules, { hasHotel: false, hasPackage: false, guests: 3, accommodationGuests: 3, playersPerTicket: 1, ticketSubtotalHuf: 0, accommodationSubtotalHuf: 0 });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.amountHuf).toBe(300);
  });

  it("omits zero-amount adjustments", () => {
    const rules = [rule({ when: "always", action: "adjust_total", amount: 0 })];
    const lines = applyPricingRuleAdjustments(rules, { hasHotel: false, hasPackage: false, guests: 1, accommodationGuests: 1, playersPerTicket: 1, ticketSubtotalHuf: 0, accommodationSubtotalHuf: 0 });
    expect(lines).toEqual([]);
  });
});
