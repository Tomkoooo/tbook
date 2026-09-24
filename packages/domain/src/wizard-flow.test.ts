import { describe, expect, it } from "vitest";
import { buildWizardSteps, canProceedWizardStep, isHotelStepValid, isRoomsStepValid, matchWizardStepIndex, resolveHotelStayPhase } from "./wizard-flow";

describe("buildWizardSteps — single event (events.length === 1)", () => {
  it("omits hotel/rooms steps entirely when the event has no hotels", () => {
    const steps = buildWizardSteps({ events: [{ id: "e1", hotelCount: 0 }], lodgingMode: "separate", wantsHotelByEventId: {}, wantsHotelCombined: null });
    expect(steps.map((s) => s.kind)).toEqual(["entries", "players", "details", "review"]);
  });

  it("shows a hotel step but not a rooms step until the guest opts in", () => {
    const steps = buildWizardSteps({ events: [{ id: "e1", hotelCount: 2 }], lodgingMode: "separate", wantsHotelByEventId: { e1: null }, wantsHotelCombined: null });
    expect(steps.map((s) => s.kind)).toEqual(["entries", "players", "hotel", "details", "review"]);
  });

  it("adds a rooms step once the guest wants a hotel", () => {
    const steps = buildWizardSteps({ events: [{ id: "e1", hotelCount: 2 }], lodgingMode: "separate", wantsHotelByEventId: { e1: true }, wantsHotelCombined: null });
    expect(steps.map((s) => s.kind)).toEqual(["entries", "players", "hotel", "rooms", "details", "review"]);
  });
});

describe("buildWizardSteps — multi event (events.length > 1)", () => {
  const events = [
    { id: "e1", hotelCount: 1 },
    { id: "e2", hotelCount: 1 },
  ];

  it("combined mode: one shared hotel step, one shared rooms step", () => {
    const steps = buildWizardSteps({ events, lodgingMode: "combined", wantsHotelByEventId: {}, wantsHotelCombined: true });
    expect(steps.filter((s) => s.kind === "hotel")).toHaveLength(1);
    expect(steps.filter((s) => s.kind === "rooms")).toHaveLength(1);
    expect(steps.find((s) => s.kind === "hotel")).toEqual({ kind: "hotel", eventId: null });
  });

  it("separate mode: one hotel/rooms pair per event", () => {
    const steps = buildWizardSteps({ events, lodgingMode: "separate", wantsHotelByEventId: { e1: true, e2: true }, wantsHotelCombined: null });
    expect(steps.filter((s) => s.kind === "hotel")).toHaveLength(2);
    expect(steps.filter((s) => s.kind === "rooms")).toHaveLength(2);
  });

  it("separate mode skips events with no hotels available", () => {
    const steps = buildWizardSteps({ events: [{ id: "e1", hotelCount: 0 }, { id: "e2", hotelCount: 1 }], lodgingMode: "separate", wantsHotelByEventId: { e2: true }, wantsHotelCombined: null });
    const hotelSteps = steps.filter((s) => s.kind === "hotel");
    expect(hotelSteps).toEqual([{ kind: "hotel", eventId: "e2" }]);
  });
});

describe("matchWizardStepIndex", () => {
  it("stays on the matching step by kind + eventId after the list changes shape", () => {
    const before = buildWizardSteps({ events: [{ id: "e1", hotelCount: 1 }], lodgingMode: "separate", wantsHotelByEventId: { e1: true }, wantsHotelCombined: null });
    const after = buildWizardSteps({ events: [{ id: "e1", hotelCount: 1 }], lodgingMode: "separate", wantsHotelByEventId: { e1: false }, wantsHotelCombined: null });
    // was on "rooms" (index 4 in `before`), which no longer exists in `after` — should fall back to that event's hotel step.
    const previous = before[3]!;
    expect(previous.kind).toBe("rooms");
    const index = matchWizardStepIndex(after, previous, 4);
    expect(after[index - 1]).toEqual({ kind: "hotel", eventId: "e1" });
  });

  it("falls back to the clamped fallback index when there is no previous step", () => {
    const steps = buildWizardSteps({ events: [{ id: "e1", hotelCount: 0 }], lodgingMode: "separate", wantsHotelByEventId: {}, wantsHotelCombined: null });
    expect(matchWizardStepIndex(steps, undefined, 99)).toBe(steps.length);
  });
});

describe("step validity", () => {
  it("hotel step requires a choice, and a selected hotel once opted in", () => {
    expect(isHotelStepValid({ hotelCount: 2, wantsHotel: null, selectedHotelId: null })).toBe(false);
    expect(isHotelStepValid({ hotelCount: 2, wantsHotel: false, selectedHotelId: null })).toBe(true);
    expect(isHotelStepValid({ hotelCount: 2, wantsHotel: true, selectedHotelId: null })).toBe(false);
    expect(isHotelStepValid({ hotelCount: 2, wantsHotel: true, selectedHotelId: "h1" })).toBe(true);
  });

  it("rooms step is trivially valid when the guest opted out of a hotel", () => {
    expect(isRoomsStepValid({ hotelCount: 2, wantsHotel: false, selectedHotelId: null, accommodationNeed: "none", accommodationGuests: 0 })).toBe(true);
  });

  it("canProceedWizardStep dispatches on step.kind and per-event hotel state", () => {
    const ctx = {
      guests: 2,
      attendeesValid: true,
      customerValid: false,
      hasQuote: false,
      hotelState: () => ({ hotelCount: 1, wantsHotel: true, selectedHotelId: "h1", accommodationNeed: "all" as const, accommodationGuests: 2 }),
    };
    expect(canProceedWizardStep({ kind: "entries" }, ctx)).toBe(true);
    expect(canProceedWizardStep({ kind: "hotel", eventId: "e1" }, ctx)).toBe(true);
    expect(canProceedWizardStep({ kind: "details" }, ctx)).toBe(false);
  });
});

describe("resolveHotelStayPhase", () => {
  it("moves through stay_choice → pick_hotel → configure_rooms", () => {
    expect(resolveHotelStayPhase({ hotelCount: 1, wantsHotel: null, selectedHotelId: null })).toBe("stay_choice");
    expect(resolveHotelStayPhase({ hotelCount: 1, wantsHotel: true, selectedHotelId: null })).toBe("pick_hotel");
    expect(resolveHotelStayPhase({ hotelCount: 1, wantsHotel: true, selectedHotelId: "h1" })).toBe("configure_rooms");
  });
});
