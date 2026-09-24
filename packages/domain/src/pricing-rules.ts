import type { PricingRule } from "@tbook/schemas";

/**
 * Ported from the legacy plugin's lib/pricing-rules.ts. Event-level pricing
 * rules — flexible adjustments without hardcoding special cases:
 * - Free entry: set_ticket_fee → 0 (always)
 * - Hotel package discount: adjust_accommodation −100 (with_hotel / with_package)
 * - Off-site surcharge: adjust_total +100 (without_hotel)
 *
 * The `when`/`action`/`amountMode` enums and the PricingRule shape itself
 * already live in @tbook/schemas (event.ts) — this module is purely the
 * evaluation logic, not the shape definition.
 *
 * Deliberately dropped vs. the legacy version: the *_LABELS Hungarian UI
 * copy constants (PRICING_RULE_WHEN_LABELS etc.) — that's frontend i18n
 * concern, not domain logic, and belongs with the admin UI in Phase 5.
 */

export interface PricingRuleContext {
  hasHotel: boolean;
  hasPackage: boolean;
  guests: number;
  accommodationGuests: number;
  /** Players per ticket/team — used for per_team_member rules when roster is fixed. */
  playersPerTicket: number;
  /** Total players on the booking (flexible team roster). Defaults to guests × playersPerTicket. */
  teamMemberCount?: number;
  ticketSubtotalHuf: number;
  accommodationSubtotalHuf: number;
}

function isRule(value: unknown): value is PricingRule {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<PricingRule>;
  return Boolean(r.id && r.when && r.action && r.amountMode);
}

/** Defensive normalization for rule arrays coming from loosely-typed storage. */
export function normalizePricingRules(raw: unknown): PricingRule[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRule).map((r, i) => ({
    id: String(r.id || `rule-${i}`),
    enabled: r.enabled !== false,
    label: String(r.label || "Price adjustment").trim() || "Price adjustment",
    when: r.when,
    action: r.action,
    amount: Number.isFinite(Number(r.amount)) ? Number(r.amount) : 0,
    amountMode: r.amountMode,
  }));
}

export function ruleMatches(rule: PricingRule, ctx: PricingRuleContext): boolean {
  if (!rule.enabled) return false;
  switch (rule.when) {
    case "always":
      return true;
    case "with_hotel":
      return ctx.hasHotel;
    case "without_hotel":
      return !ctx.hasHotel;
    case "with_package":
      return ctx.hasHotel && ctx.hasPackage;
    default:
      return false;
  }
}

/** Resolve absolute ticket fee override from matching set_ticket_fee rules (last wins). */
export function resolveTicketFeeOverride(
  rules: PricingRule[] | null | undefined,
  ctx: Pick<PricingRuleContext, "hasHotel" | "hasPackage" | "guests" | "accommodationGuests" | "playersPerTicket" | "teamMemberCount">,
): number | null {
  const list = normalizePricingRules(rules);
  let override: number | null = null;
  const baseCtx: PricingRuleContext = {
    ...ctx,
    playersPerTicket: ctx.playersPerTicket ?? 1,
    ticketSubtotalHuf: 0,
    accommodationSubtotalHuf: 0,
  };
  for (const rule of list) {
    if (rule.action !== "set_ticket_fee") continue;
    if (!ruleMatches(rule, baseCtx)) continue;
    override = Math.max(0, rule.amount);
  }
  return override;
}

function resolveTeamMemberCount(ctx: PricingRuleContext): number {
  if (ctx.teamMemberCount != null && Number.isFinite(ctx.teamMemberCount) && ctx.teamMemberCount > 0) {
    return Math.max(1, Math.floor(ctx.teamMemberCount));
  }
  const players = Math.max(1, ctx.playersPerTicket ?? 1);
  return Math.max(1, ctx.guests) * players;
}

function computeRuleAmount(rule: PricingRule, ctx: PricingRuleContext): number {
  const amount = rule.amount;
  switch (rule.amountMode) {
    case "fixed":
      return amount;
    case "per_person":
    case "per_team":
      return amount * Math.max(1, ctx.guests);
    case "per_team_member":
      return amount * resolveTeamMemberCount(ctx);
    case "per_accommodation_guest":
      return amount * Math.max(1, ctx.accommodationGuests || ctx.guests);
    case "percent_accommodation":
      return (ctx.accommodationSubtotalHuf * amount) / 100;
    case "percent_ticket":
      return (ctx.ticketSubtotalHuf * amount) / 100;
    default:
      return amount;
  }
}

export interface AppliedPricingRuleLine {
  key: string;
  label: string;
  amountHuf: number;
  ruleId: string;
  action: PricingRule["action"];
}

/** Apply adjust_* rules after base quote subtotals are known. */
export function applyPricingRuleAdjustments(
  rules: PricingRule[] | null | undefined,
  ctx: PricingRuleContext,
): AppliedPricingRuleLine[] {
  const lines: AppliedPricingRuleLine[] = [];
  for (const rule of normalizePricingRules(rules)) {
    if (rule.action === "set_ticket_fee") continue;
    if (!ruleMatches(rule, ctx)) continue;
    const amountHuf = Math.round(computeRuleAmount(rule, ctx));
    if (amountHuf === 0) continue;
    lines.push({ key: `pricing_rule:${rule.id}`, label: rule.label, amountHuf, ruleId: rule.id, action: rule.action });
  }
  return lines;
}
