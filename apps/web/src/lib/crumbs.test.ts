import { describe, expect, it } from "vitest";
import { buildCrumbs, segmentLabel } from "./crumbs";

const E = "64b7f0a1c2d3e4f5a6b7c8d9";
const G = "aaaaaaaaaaaaaaaaaaaaaaaa";
const labels = (path: string, names = { event: "Sörfeszt", group: "Festivals" }) => buildCrumbs(path, names).map((crumb) => crumb.label);

describe("buildCrumbs", () => {
  it("event pages read Events › name › Tool › detail", () => {
    expect(labels(`/admin/events/${E}`)).toEqual(["Events", "Sörfeszt"]);
    expect(labels(`/admin/events/${E}/bus`)).toEqual(["Events", "Sörfeszt", "Bus"]);
    expect(labels(`/admin/events/${E}/bus/${E}`)).toEqual(["Events", "Sörfeszt", "Bus", "Details"]);
    expect(labels(`/admin/events/${E}/bookings/new`)).toEqual(["Events", "Sörfeszt", "Guests", "New"]);
  });

  it("links every crumb to its own path", () => {
    expect(buildCrumbs(`/admin/events/${E}/stand/products`, { event: "X" }).map((crumb) => crumb.href)).toEqual([
      "/admin/events",
      `/admin/events/${E}`,
      `/admin/events/${E}/stand`,
      `/admin/events/${E}/stand/products`,
    ]);
  });

  it("leaves the event name null (a placeholder), never 'Details', while it is unknown", () => {
    const crumbs = buildCrumbs(`/admin/events/${E}/bus`, {});
    expect(crumbs[1]).toEqual({ label: null, href: `/admin/events/${E}` });
  });

  it("group pages read Event groups › name › Tool", () => {
    expect(labels(`/admin/groups/${G}`)).toEqual(["Event groups", "Festivals"]);
    expect(labels(`/admin/groups/${G}/hotels`)).toEqual(["Event groups", "Festivals", "Hotels"]);
    expect(labels(`/admin/groups/${G}/hotels/${E}`)).toEqual(["Event groups", "Festivals", "Hotels", "Details"]);
    expect(labels(`/admin/groups/${G}/events`)).toEqual(["Event groups", "Festivals", "Events"]);
  });

  it("org pages keep the plain trail from Home", () => {
    expect(labels("/admin")).toEqual(["Home"]);
    expect(labels("/admin/events")).toEqual(["Home", "Events"]);
    expect(labels("/admin/events/new")).toEqual(["Home", "Events", "New"]);
    expect(labels("/admin/merch")).toEqual(["Home", "Merch register"]);
    expect(labels("/admin/members")).toEqual(["Home", "Team"]);
    expect(labels(`/admin/bookings/${E}`)).toEqual(["Home", "Bookings", "Details"]);
  });

  it("names segments readably", () => {
    expect(segmentLabel("check-in")).toBe("Check-in");
    expect(segmentLabel("device-link")).toBe("Device link");
    expect(segmentLabel("some-thing")).toBe("Some thing");
  });
});
