import type { HotelPricing, OptionChoice, OptionDef, PriceBasis, PriceQuote, PricingRule, Selections } from "@tbook/schemas";

/** @tbook/schemas doesn't export these as standalone types — derive them. */
type PriceLine = PriceQuote["lines"][number];
type SelectionValue = Selections[string];
import { mergeOptionSchemas } from "./option-merge";
import { applyPricingRuleAdjustments, resolveTicketFeeOverride } from "./pricing-rules";
import {
  findPackageDeal,
  findRoomType,
  flattenAddonOptions,
  normalizeHotelPricing,
  packageUnitsForGuests,
  parsePackageUnits,
  resolveAccommodationMode,
  PACKAGE_DEAL_SELECTION_KEY,
  PACKAGE_UNITS_SELECTION_KEY,
  ROOM_TYPE_SELECTION_KEY,
} from "./hotel-pricing";
import { toGrossAmount } from "./vat";

// Selection-key constants live in hotel-pricing.ts (single source) — import from there directly.

/** Ported from the legacy plugin's lib/pricing.ts — the core tBook pricing engine. */

const DEFAULT_VAT_PERCENT = 27;

function roundHuf(amount: number): number {
  return Math.round(Number.isFinite(amount) ? amount : 0);
}

function basisOf(priceBasis: PriceBasis | undefined, fallback: PriceBasis = "gross"): PriceBasis {
  return priceBasis ?? fallback;
}

function vatOf(vatPercent: number | undefined): number {
  return vatPercent ?? DEFAULT_VAT_PERCENT;
}

function toGrossHuf(amount: number, basis: PriceBasis, vatPercent: number): number {
  return roundHuf(toGrossAmount(Math.max(0, amount), basis, vatPercent));
}

function grossChoicePrice(choice: OptionChoice, priceBasis: PriceBasis, vatPercent: number): OptionChoice {
  return { ...choice, priceHuf: toGrossHuf(choice.priceHuf, priceBasis, vatPercent) };
}

function withGrossOptionPrices(option: OptionDef, priceBasis: PriceBasis, vatPercent: number): OptionDef {
  return {
    ...option,
    choices: option.choices?.map((c) => grossChoicePrice(c, priceBasis, vatPercent)),
    unitPriceHuf: option.unitPriceHuf != null ? toGrossHuf(option.unitPriceHuf, priceBasis, vatPercent) : option.unitPriceHuf,
  };
}

type PriceMode = NonNullable<OptionDef["priceMode"]>;

function scaleByMode(unitHuf: number, mode: PriceMode | undefined, guests: number, nights: number, accommodationBaseHuf: number): number {
  switch (mode) {
    case "per_person":
      return unitHuf * guests;
    case "per_night":
      return unitHuf * nights;
    case "per_person_per_night":
      return unitHuf * guests * nights;
    case "percent":
      return (accommodationBaseHuf * unitHuf) / 100;
    case "fixed":
    default:
      return unitHuf;
  }
}

export function calculateAccommodationBaseHuf(baseRateHuf: number, baseRateMode: "per_person_per_night" | "per_night" | "per_person" | "per_booking", guests: number, nights: number): number {
  const rate = Math.max(0, baseRateHuf);
  switch (baseRateMode) {
    case "per_person_per_night":
      return roundHuf(rate * guests * nights);
    case "per_night":
      return roundHuf(rate * nights);
    case "per_person":
      return roundHuf(rate * guests);
    case "per_booking":
    default:
      return roundHuf(rate);
  }
}

/** True when the option is visible/applicable given the current selections. */
export function isOptionApplicable(option: OptionDef, selections: Selections): boolean {
  const dep = option.dependsOn;
  if (!dep || !dep.key || dep.values.length === 0) return true;
  const current = selections[dep.key];
  if (current == null) return false;
  const values = Array.isArray(current) ? current.map(String) : [String(current)];
  return values.some((v) => dep.values.includes(v));
}

export function resolveSelectionValue(option: OptionDef, selections: Selections): SelectionValue | null {
  if (Object.prototype.hasOwnProperty.call(selections, option.key)) {
    return selections[option.key] ?? null;
  }
  if (option.defaultValue != null) return option.defaultValue;
  return null;
}

function findChoice(option: OptionDef, value: string): OptionChoice | null {
  return option.choices?.find((c) => c.value === value) ?? null;
}

export interface SelectionError {
  key: string;
  message: string;
}

export function validateHotelSelections(pricing: HotelPricing, selections: Selections, guests?: number): SelectionError[] {
  const normalized = normalizeHotelPricing(pricing);
  const mode = resolveAccommodationMode(normalized);
  const errors: SelectionError[] = [];

  const packageKey = selections[PACKAGE_DEAL_SELECTION_KEY];
  const packageDeal = typeof packageKey === "string" && packageKey ? findPackageDeal(normalized, packageKey) : null;
  const packageUnits = parsePackageUnits(selections as Record<string, unknown>);

  if (mode === "packages") {
    if (!packageDeal && !packageUnits) {
      errors.push({ key: PACKAGE_DEAL_SELECTION_KEY, message: "Please select a package deal" });
    }
    if (packageUnits) {
      let capacity = 0;
      for (const [key, qty] of Object.entries(packageUnits)) {
        const pkg = findPackageDeal(normalized, key);
        if (!pkg) {
          errors.push({ key: PACKAGE_UNITS_SELECTION_KEY, message: `Invalid package: ${key}` });
          continue;
        }
        const cap = pkg.maxGuests != null && pkg.maxGuests > 0 ? pkg.maxGuests : 1;
        capacity += qty * cap;
      }
      if (guests != null && capacity > 0 && capacity < guests) {
        errors.push({ key: PACKAGE_UNITS_SELECTION_KEY, message: `Selected packages cover ${capacity} guests, but ${guests} need accommodation.` });
      }
    }
  } else {
    const roomKey = selections[ROOM_TYPE_SELECTION_KEY];
    if (typeof roomKey !== "string" || !findRoomType(normalized, roomKey)) {
      errors.push({ key: ROOM_TYPE_SELECTION_KEY, message: "Please select a room type" });
    }
    if (typeof packageKey === "string" && packageKey && !packageDeal) {
      errors.push({ key: PACKAGE_DEAL_SELECTION_KEY, message: "Invalid package deal" });
    }
  }

  const addonOptions = flattenAddonOptions(normalized);
  errors.push(...validateSelections(addonOptions, selections));
  return errors;
}

/**
 * Validates customer selections against an option schema. Unknown keys,
 * missing required options, out-of-range numbers and unknown choice values
 * are all rejected — the API never trusts client-submitted prices.
 */
export function validateSelections(options: OptionDef[], selections: Selections): SelectionError[] {
  const errors: SelectionError[] = [];
  const known = new Set(options.map((o) => o.key));

  for (const key of Object.keys(selections)) {
    if (key === ROOM_TYPE_SELECTION_KEY || key === PACKAGE_DEAL_SELECTION_KEY || key === PACKAGE_UNITS_SELECTION_KEY) continue;
    if (!known.has(key)) {
      errors.push({ key, message: `Unknown option: ${key}` });
    }
  }

  for (const option of options) {
    if (!isOptionApplicable(option, selections)) continue;
    const value = resolveSelectionValue(option, selections);

    if (value == null) {
      if (option.required) {
        errors.push({ key: option.key, message: `Required option: ${option.label}` });
      }
      continue;
    }

    switch (option.type) {
      case "select": {
        if (typeof value !== "string" || !findChoice(option, value)) {
          errors.push({ key: option.key, message: `Invalid value: ${option.label}` });
        }
        break;
      }
      case "multiselect": {
        const values = Array.isArray(value) ? value : null;
        if (!values || values.some((v) => !findChoice(option, String(v)))) {
          errors.push({ key: option.key, message: `Invalid value: ${option.label}` });
        }
        break;
      }
      case "number": {
        const n = Number(value);
        if (!Number.isFinite(n)) {
          errors.push({ key: option.key, message: `Number required: ${option.label}` });
          break;
        }
        if (option.min != null && n < option.min) errors.push({ key: option.key, message: `${option.label}: minimum ${option.min}` });
        if (option.max != null && n > option.max) errors.push({ key: option.key, message: `${option.label}: maximum ${option.max}` });
        break;
      }
      case "checkbox": {
        if (typeof value !== "boolean") errors.push({ key: option.key, message: `Invalid value: ${option.label}` });
        break;
      }
    }
  }

  return errors;
}

function optionAmountHuf(option: OptionDef, value: SelectionValue, guests: number, nights: number, accommodationBaseHuf: number): { amountHuf: number; detail: string } | null {
  switch (option.type) {
    case "select": {
      const choice = findChoice(option, String(value));
      if (!choice || choice.priceHuf === 0) return choice ? { amountHuf: 0, detail: choice.label } : null;
      return { amountHuf: scaleByMode(choice.priceHuf, choice.priceMode, guests, nights, accommodationBaseHuf), detail: choice.label };
    }
    case "multiselect": {
      const values = Array.isArray(value) ? value : [];
      let amount = 0;
      const labels: string[] = [];
      for (const v of values) {
        const choice = findChoice(option, String(v));
        if (!choice) continue;
        amount += scaleByMode(choice.priceHuf, choice.priceMode, guests, nights, accommodationBaseHuf);
        labels.push(choice.label);
      }
      if (labels.length === 0) return null;
      return { amountHuf: amount, detail: labels.join(", ") };
    }
    case "number": {
      const quantity = Math.max(0, Number(value) || 0);
      if (quantity === 0) return null;
      const unit = option.unitPriceHuf ?? 0;
      const scaled = scaleByMode(unit, option.priceMode ?? "fixed", guests, nights, accommodationBaseHuf);
      return { amountHuf: scaled * quantity, detail: String(quantity) };
    }
    case "checkbox": {
      if (value !== true) return null;
      const unit = option.unitPriceHuf ?? 0;
      return { amountHuf: scaleByMode(unit, option.priceMode ?? "fixed", guests, nights, accommodationBaseHuf), detail: "Yes" };
    }
    default:
      return null;
  }
}

export type TicketFeeMode = "per_person" | "per_booking" | "per_team";

export interface QuoteInput {
  /** Event base ticket fee (stored net or gross per ticketPriceBasis). */
  ticketFeeHuf: number;
  ticketFeeMode?: TicketFeeMode;
  ticketPriceBasis?: PriceBasis;
  ticketVatPercent?: number;
  guests: number;
  /** Hotel/package headcount; defaults to `guests` when omitted. */
  accommodationGuests?: number;
  /** Required when accommodation is selected. */
  nights?: number;
  /** Omit for ticket-only bookings — accommodation is optional per booking. */
  accommodation?: HotelPricing | null;
  /** Group-level booking options (merged with hotel options when both exist). */
  groupOptions?: OptionDef[];
  groupPriceBasis?: PriceBasis;
  groupVatPercent?: number;
  selections?: Selections | null;
  /** Event-level special pricing rules (discounts, surcharges, free entry override). */
  pricingRules?: PricingRule[] | null;
  /** Players per team ticket — for per_team_member pricing rules when roster is fixed. */
  playersPerTicket?: number;
  /** Total players on the booking (flexible team roster). */
  teamMemberCount?: number;
}

export interface PriceQuoteResult {
  guests: number;
  accommodationGuests: number;
  nights: number;
  ticketSubtotalHuf: number;
  accommodationBaseHuf: number;
  accommodationOptionsHuf: number;
  accommodationSubtotalHuf: number;
  totalHuf: number;
  lines: PriceLine[];
}

/**
 * Core tBook pricing engine (pure).
 *
 * total = event ticket fee (+ accommodation base + option add-ons when a
 * hotel is selected). Ticket-only bookings simply omit `accommodation`.
 */
export function calculateBookingQuote(input: QuoteInput): PriceQuoteResult {
  const guests = Math.max(1, Math.floor(input.guests || 1));
  const hasHotel = Boolean(input.accommodation);
  const selectionsPreview = input.selections ?? {};
  const hasPackage = Boolean(selectionsPreview[PACKAGE_DEAL_SELECTION_KEY] || parsePackageUnits(selectionsPreview as Record<string, unknown>));
  const accommodationGuests = hasHotel ? Math.max(1, Math.floor(input.accommodationGuests ?? input.guests ?? 1)) : Math.max(0, Math.floor(input.accommodationGuests ?? 0));
  const nights = Math.max(0, Math.floor(input.nights ?? 0));
  const ticketFeeMode = input.ticketFeeMode ?? "per_person";

  const ticketFeeOverride = resolveTicketFeeOverride(input.pricingRules, {
    hasHotel,
    hasPackage,
    guests,
    accommodationGuests: accommodationGuests || guests,
    playersPerTicket: input.playersPerTicket ?? 1,
    teamMemberCount: input.teamMemberCount,
  });
  const effectiveTicketFee = ticketFeeOverride != null ? ticketFeeOverride : Math.max(0, input.ticketFeeHuf);

  const ticketUnitGross = toGrossHuf(effectiveTicketFee, basisOf(input.ticketPriceBasis, "gross"), vatOf(input.ticketVatPercent));
  const ticketSubtotalHuf = roundHuf(ticketFeeMode === "per_booking" ? ticketUnitGross : ticketUnitGross * guests);

  const ticketLineLabel = ticketFeeMode === "per_booking" ? "Entry" : ticketFeeMode === "per_team" ? `Entry × ${guests} teams` : `Entry × ${guests} people`;

  const lines: PriceLine[] = [{ key: "ticket", label: ticketLineLabel, amountHuf: ticketSubtotalHuf }];

  let accommodationBaseHuf = 0;
  let accommodationOptionsHuf = 0;

  const groupBasis = basisOf(input.groupPriceBasis, "gross");
  const groupVat = vatOf(input.groupVatPercent);
  const groupOptionsGross = (input.groupOptions ?? []).map((o) => withGrossOptionPrices(o, groupBasis, groupVat));

  let mergedOptions: OptionDef[] = groupOptionsGross;

  if (input.accommodation) {
    const acc = normalizeHotelPricing(input.accommodation);
    const accBasis = basisOf(acc.priceBasis, "gross");
    const accVat = vatOf(acc.vatPercent);
    const mode = resolveAccommodationMode(acc);
    let effectiveNights = Math.max(1, nights);
    const selections = input.selections ?? {};

    const roomTypeKey = String(selections[ROOM_TYPE_SELECTION_KEY] ?? "");
    const roomType = findRoomType(acc, roomTypeKey);
    const packageKey = String(selections[PACKAGE_DEAL_SELECTION_KEY] ?? "");
    const packageDeal = packageKey ? findPackageDeal(acc, packageKey) : null;
    const packageUnits = parsePackageUnits(selections as Record<string, unknown>);

    if (mode === "packages" && packageUnits) {
      for (const [key, qty] of Object.entries(packageUnits)) {
        const pkg = findPackageDeal(acc, key);
        if (!pkg) continue;
        effectiveNights = Math.max(effectiveNights, pkg.nights);
        const unitGross = roundHuf(toGrossHuf(pkg.priceHuf, accBasis, accVat));
        const lineAmount = roundHuf(unitGross * qty);
        accommodationBaseHuf += lineAmount;
        lines.push({ key: `package_unit:${key}`, label: qty > 1 ? `${pkg.label} × ${qty}` : pkg.label, amountHuf: lineAmount });
      }
    } else if (mode === "packages" && packageDeal) {
      effectiveNights = packageDeal.nights;
      const packageUnitCount = packageUnitsForGuests(packageDeal, accommodationGuests);
      const unitGross = roundHuf(toGrossHuf(packageDeal.priceHuf, accBasis, accVat));
      accommodationBaseHuf = roundHuf(unitGross * packageUnitCount);
      lines.push({ key: "accommodation_base", label: packageUnitCount > 1 ? `${packageDeal.label} × ${packageUnitCount}` : packageDeal.label, amountHuf: accommodationBaseHuf });
    } else if (roomType) {
      const packageUnitCount = packageDeal != null ? packageUnitsForGuests(packageDeal, accommodationGuests) : 1;
      if (packageDeal && packageDeal.nights === effectiveNights && (!packageDeal.roomTypeKey || packageDeal.roomTypeKey === roomTypeKey)) {
        const unitGross = roundHuf(toGrossHuf(packageDeal.priceHuf, accBasis, accVat));
        accommodationBaseHuf = roundHuf(unitGross * packageUnitCount);
        lines.push({
          key: "accommodation_base",
          label: packageUnitCount > 1 ? `${packageDeal.label} (${roomType.label}) × ${packageUnitCount}` : `${packageDeal.label} (${roomType.label})`,
          amountHuf: accommodationBaseHuf,
        });
      } else {
        const roomGross = toGrossHuf(roomType.baseRateHuf, accBasis, accVat);
        accommodationBaseHuf = roundHuf(roomGross * accommodationGuests * effectiveNights);
        lines.push({ key: "accommodation_base", label: `${roomType.label} (${accommodationGuests} guests, ${effectiveNights} nights)`, amountHuf: accommodationBaseHuf });
      }
    }

    const hotelAddonsGross = flattenAddonOptions(acc).map((o) => withGrossOptionPrices(o, accBasis, accVat));
    mergedOptions = mergeOptionSchemas(groupOptionsGross, hotelAddonsGross);
  }

  const selections = input.selections ?? {};
  const accNormalized = input.accommodation ? normalizeHotelPricing(input.accommodation) : null;
  const packageKeyForNights = String(selections[PACKAGE_DEAL_SELECTION_KEY] ?? "");
  const packageUnitsForNights = parsePackageUnits(selections as Record<string, unknown>);
  const packageForNights = accNormalized && packageKeyForNights ? findPackageDeal(accNormalized, packageKeyForNights) : null;
  const firstPackageFromUnits = accNormalized && packageUnitsForNights ? findPackageDeal(accNormalized, Object.keys(packageUnitsForNights)[0] ?? "") : null;
  const quotedNights =
    input.accommodation && accNormalized && resolveAccommodationMode(accNormalized) === "packages" && (packageForNights || firstPackageFromUnits)
      ? (packageForNights ?? firstPackageFromUnits)!.nights
      : input.accommodation
        ? Math.max(1, nights)
        : nights;
  const effectiveNights = quotedNights;
  const optionBaseHuf = accommodationBaseHuf || ticketSubtotalHuf;
  const sorted = [...mergedOptions].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  for (const option of sorted) {
    if (!isOptionApplicable(option, selections)) continue;
    const value = resolveSelectionValue(option, selections);
    if (value == null) continue;
    const result = optionAmountHuf(option, value, accommodationGuests, effectiveNights, optionBaseHuf);
    if (!result) continue;
    const amountHuf = roundHuf(result.amountHuf);
    accommodationOptionsHuf += amountHuf;
    if (amountHuf !== 0) {
      lines.push({ key: `option:${option.key}`, label: `${option.label}: ${result.detail}`, amountHuf });
    }
  }

  let accommodationSubtotalHuf = accommodationBaseHuf + accommodationOptionsHuf;
  let ticketSubtotalFinal = ticketSubtotalHuf;

  const ruleLines = applyPricingRuleAdjustments(input.pricingRules, {
    hasHotel,
    hasPackage,
    guests,
    accommodationGuests: accommodationGuests || guests,
    playersPerTicket: input.playersPerTicket ?? 1,
    teamMemberCount: input.teamMemberCount,
    ticketSubtotalHuf: ticketSubtotalFinal,
    accommodationSubtotalHuf,
  });

  let adjustTotalHuf = 0;
  for (const ruleLine of ruleLines) {
    if (ruleLine.action === "adjust_ticket") {
      ticketSubtotalFinal = roundHuf(ticketSubtotalFinal + ruleLine.amountHuf);
    } else if (ruleLine.action === "adjust_accommodation") {
      accommodationSubtotalHuf = roundHuf(accommodationSubtotalHuf + ruleLine.amountHuf);
    } else if (ruleLine.action === "adjust_total") {
      adjustTotalHuf = roundHuf(adjustTotalHuf + ruleLine.amountHuf);
    }
    lines.push({ key: ruleLine.key, label: ruleLine.label, amountHuf: ruleLine.amountHuf });
  }

  return {
    guests,
    accommodationGuests,
    nights: quotedNights,
    ticketSubtotalHuf: ticketSubtotalFinal,
    accommodationBaseHuf,
    accommodationOptionsHuf,
    accommodationSubtotalHuf,
    totalHuf: roundHuf(ticketSubtotalFinal + accommodationSubtotalHuf + adjustTotalHuf),
    lines,
  };
}
