/**
 * Booking wizard step-flow (pure).
 *
 * Deliberate redesign vs. the legacy plugin's lib/booking-wizard-flow.ts,
 * per the approved rebuild plan: the legacy code had two parallel
 * implementations — a numeric 1-6 step machine with bespoke skip logic
 * (singleWizardStepLabels/canProceedBookingStep/nextWizardStep/
 * prevWizardStep) for the single-event wizard, and a typed step-list
 * machine (buildMultiWizardSteps/matchMultiWizardStepIndex) for the
 * multi-event wizard — with near-duplicated validity logic between them
 * (isMultiHotelStepValid/isMultiRoomsStepValid literally delegated to the
 * single-wizard's isStep2Valid/isStep3RoomsValid already).
 *
 * Here there is ONE step machine, `buildWizardSteps`, parametrized over
 * `events: WizardEventInput[]` — length 1 behaves like the legacy single
 * wizard, length N like the legacy multi wizard. Because the concrete step
 * LIST already excludes hidden steps (no hotel step when no event has
 * hotels; no rooms step when the guest opted out), "next"/"prev" collapse
 * to plain array-index arithmetic — the legacy nextWizardStep/
 * prevWizardStep/displaySingleWizardStep skip-logic functions are no
 * longer needed at all.
 *
 * Step label copy (the legacy tbookT(locale, "stepEntries", ...) i18n
 * calls) is dropped from this package on purpose — @tbook/domain is
 * framework/presentation-free. The frontend (Phase 6) maps `step.kind` (and
 * `event.name` for per-event hotel/rooms steps) to localized labels.
 */

export type WizardStepKind = "entries" | "players" | "hotel" | "rooms" | "details" | "review";

export type WizardStepDef =
  | { kind: "entries" }
  | { kind: "players" }
  | { kind: "hotel"; eventId: string | null }
  | { kind: "rooms"; eventId: string | null }
  | { kind: "details" }
  | { kind: "review" };

/** Only meaningful when events.length > 1. For a single event, key wantsHotelByEventId by that event's id. */
export type LodgingMode = "combined" | "separate";

export interface WizardEventInput {
  id: string;
  /** Number of hotels available for this event. */
  hotelCount: number;
}

export interface BuildWizardStepsInput {
  events: WizardEventInput[];
  lodgingMode: LodgingMode;
  /** Per-event hotel choice — used directly when lodgingMode is "separate" (or events.length === 1). */
  wantsHotelByEventId: Record<string, boolean | null>;
  /** Shared hotel choice across all events — used when lodgingMode is "combined" and events.length > 1. */
  wantsHotelCombined: boolean | null;
}

function anyEventHasHotels(events: WizardEventInput[]): boolean {
  return events.some((e) => e.hotelCount > 0);
}

/** Builds the concrete, already-filtered step list for the current wizard state. */
export function buildWizardSteps(input: BuildWizardStepsInput): WizardStepDef[] {
  const steps: WizardStepDef[] = [{ kind: "entries" }, { kind: "players" }];
  const useCombined = input.lodgingMode === "combined" && input.events.length > 1;

  if (anyEventHasHotels(input.events)) {
    if (useCombined) {
      steps.push({ kind: "hotel", eventId: null });
      if (input.wantsHotelCombined === true) {
        steps.push({ kind: "rooms", eventId: null });
      }
    } else {
      for (const event of input.events) {
        if (event.hotelCount === 0) continue;
        steps.push({ kind: "hotel", eventId: event.id });
        if (input.wantsHotelByEventId[event.id] === true) {
          steps.push({ kind: "rooms", eventId: event.id });
        }
      }
    }
  }

  steps.push({ kind: "details" }, { kind: "review" });
  return steps;
}

/** Prefer matching by kind + eventId when the step list shrinks/grows (e.g. wantsHotel toggled). */
export function matchWizardStepIndex(steps: WizardStepDef[], previous: WizardStepDef | undefined, fallbackIndex1Based: number): number {
  if (steps.length === 0) return 1;
  if (previous) {
    const exact = steps.findIndex((s) => {
      if (s.kind !== previous.kind) return false;
      if (s.kind === "hotel" || s.kind === "rooms") {
        return previous.kind === s.kind && s.eventId === (previous as { eventId: string | null }).eventId;
      }
      return true;
    });
    if (exact >= 0) return exact + 1;

    // Rooms step removed (chose entry-only): stay on that event's hotel step.
    if (previous.kind === "rooms") {
      const hotelIdx = steps.findIndex((s) => s.kind === "hotel" && s.eventId === previous.eventId);
      if (hotelIdx >= 0) return hotelIdx + 1;
    }

    // Lodging mode switch: jump to the first hotel step (or players if none).
    if (previous.kind === "hotel" || previous.kind === "rooms") {
      const firstHotel = steps.findIndex((s) => s.kind === "hotel");
      if (firstHotel >= 0) return firstHotel + 1;
      const players = steps.findIndex((s) => s.kind === "players");
      if (players >= 0) return players + 1;
    }
  }
  return Math.min(Math.max(1, fallbackIndex1Based), steps.length);
}

export type AccommodationNeed = "none" | "all" | "some";

export interface HotelStepState {
  hotelCount: number;
  wantsHotel: boolean | null;
  selectedHotelId: string | null;
}

export interface RoomsStepState extends HotelStepState {
  accommodationNeed: AccommodationNeed;
  accommodationGuests: number;
  packagesRequired?: boolean;
  hasPackageSelection?: boolean;
  roomsRequired?: boolean;
  hasRoomSelection?: boolean;
}

export function isEntriesStepValid(guests: number): boolean {
  return Number.isFinite(guests) && guests >= 1;
}

/** Hotel step: stay choice + hotel pick (rooms are a separate step). */
export function isHotelStepValid(input: HotelStepState): boolean {
  if (input.hotelCount === 0) return true;
  if (input.wantsHotel === null) return false;
  if (input.wantsHotel === false) return true;
  return Boolean(input.selectedHotelId);
}

/** Rooms step: who needs a room + package/room selection readiness. */
export function isRoomsStepValid(input: RoomsStepState): boolean {
  if (input.hotelCount === 0 || input.wantsHotel !== true) return true;
  if (!input.selectedHotelId) return false;
  if (input.accommodationNeed === "some" && input.accommodationGuests < 1) return false;
  if (input.accommodationNeed === "none") return false;
  if (input.packagesRequired && !input.hasPackageSelection) return false;
  if (input.roomsRequired && !input.hasRoomSelection) return false;
  return true;
}

export type HotelStayPhase = "stay_choice" | "pick_hotel" | "configure_rooms";

export function resolveHotelStayPhase(input: HotelStepState): HotelStayPhase {
  if (input.hotelCount === 0) return "stay_choice";
  if (input.wantsHotel !== true) return "stay_choice";
  if (!input.selectedHotelId) return "pick_hotel";
  return "configure_rooms";
}

export interface WizardValidityContext {
  guests: number;
  attendeesValid: boolean;
  customerValid: boolean;
  hasQuote: boolean;
  /** Resolve the hotel/rooms state for a given step's eventId (null = combined). */
  hotelState: (eventId: string | null) => RoomsStepState;
}

/** Whether the "Continue"/"Pay" action is enabled for the given step. */
export function canProceedWizardStep(step: WizardStepDef, ctx: WizardValidityContext): boolean {
  switch (step.kind) {
    case "entries":
      return isEntriesStepValid(ctx.guests);
    case "players":
      return ctx.attendeesValid;
    case "hotel":
      return isHotelStepValid(ctx.hotelState(step.eventId));
    case "rooms":
      return isRoomsStepValid(ctx.hotelState(step.eventId));
    case "details":
      return ctx.customerValid;
    case "review":
      return ctx.hasQuote;
    default:
      return false;
  }
}
