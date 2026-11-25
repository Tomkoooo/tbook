import { describe, expect, it } from "vitest";
import { busWaitlistDemand, type BusWaitlistRow } from "./waitlist";
import { busWaitlistRouteId, busWaitlistValue, isBusWaitlistValue, parseBusValue } from "./service";

const row = (routeId: string | null, name = "X"): BusWaitlistRow => ({
  position: 1, name, registrationNumber: null, email: "", phone: "", joinedAt: new Date(), notifiedAt: null,
  routeId, routeCode: routeId ? "B1" : "", routeName: routeId ? "Szeged" : "", routeAskedAt: null,
});

describe("bus waitlist route answer", () => {
  it("accepts the plain and the route-specific waitlist answer", () => {
    expect(isBusWaitlistValue("waitlist")).toBe(true);
    expect(isBusWaitlistValue(busWaitlistValue("abc"))).toBe(true);
    expect(isBusWaitlistValue("abc")).toBe(false);
    expect(isBusWaitlistValue("abc~1")).toBe(false);
  });
  it("reads the wanted route", () => {
    expect(busWaitlistRouteId("waitlist:abc")).toBe("abc");
    expect(busWaitlistRouteId("waitlist")).toBeNull();
    expect(busWaitlistRouteId("abc~1")).toBeNull();
    expect(parseBusValue("waitlist:abc")).toBeNull();
  });
  it("counts demand per route", () => {
    const demand = busWaitlistDemand([row("r1"), row("r1"), row(null)]);
    expect(demand.routes).toEqual([{ routeId: "r1", code: "B1", name: "Szeged", count: 2 }]);
    expect(demand.noRoute).toBe(1);
  });
});
