import { MongoMemoryServer } from "mongodb-memory-server";
import { BookingModel, EventGroupModel, EventModel, HotelModel, OrganizationModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPublicEntryList, getPublicEventDetail, listPublicDirectory, listPublicEventsForGroup } from "./public-catalog-service";

let apiKeySeq = 0;

async function createGroup(overrides: Partial<Record<string, unknown>> = {}) {
  apiKeySeq += 1;
  return EventGroupModel.create({
    name: "World Darts Festival",
    status: "active",
    listOnTBookSite: true,
    listingTitle: "",
    listingUrl: "https://worlddartsfestival.com",
    listingImage: "",
    apiKeyHash: `hash-${apiKeySeq}`,
    apiKeyHint: `tbk_${apiKeySeq}…0000`,
    apiKeyCreatedAt: new Date(),
    ...overrides,
  });
}

async function createEvent(groupId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return EventModel.create({
    groupId,
    name: "Első WDF verseny",
    status: "active",
    startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    endDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    ticketFeeHuf: 5000,
    ticketFeeMode: "per_person",
    ticketPriceBasis: "gross",
    ticketVatPercent: 27,
    publicListing: "listed",
    ...overrides,
  });
}

describe("public-catalog-service", () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
  });

  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      EventGroupModel.deleteMany({}),
      EventModel.deleteMany({}),
      HotelModel.deleteMany({}),
      BookingModel.deleteMany({}),
      OrganizationModel.deleteMany({}),
    ]);
  });

  describe("listPublicDirectory", () => {
    it("lists a group with at least one active, not-yet-ended event", async () => {
      const group = await createGroup();
      await createEvent(String(group._id));

      const listings = await listPublicDirectory();
      expect(listings).toHaveLength(1);
      expect(listings[0]?.id).toBe(String(group._id));
      expect(listings[0]?.activeEventCount).toBe(1);
      expect(listings[0]?.nextEventStart).toBeInstanceOf(Date);
    });

    it("omits a group with zero active upcoming events", async () => {
      await createGroup();
      const listings = await listPublicDirectory();
      expect(listings).toHaveLength(0);
    });

    it("omits a group not opted into the public directory", async () => {
      const group = await createGroup({ listOnTBookSite: false });
      await createEvent(String(group._id));
      const listings = await listPublicDirectory();
      expect(listings).toHaveLength(0);
    });

    it("omits an event that already ended", async () => {
      const group = await createGroup();
      await createEvent(String(group._id), {
        startDate: new Date(Date.now() - 48 * 60 * 60 * 1000),
        endDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
      const listings = await listPublicDirectory();
      expect(listings).toHaveLength(0);
    });
  });

  describe("listPublicEventsForGroup", () => {
    it("returns active, publicly-listed events with the full public field shape", async () => {
      const group = await createGroup();
      await createEvent(String(group._id));

      const events = await listPublicEventsForGroup(String(group._id));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ name: "Első WDF verseny", ticketFeeHuf: 5000, currency: "HUF" });
    });

    it("excludes events marked link_only", async () => {
      const group = await createGroup();
      await createEvent(String(group._id), { publicListing: "link_only" });
      expect(await listPublicEventsForGroup(String(group._id))).toHaveLength(0);
    });

    it("excludes draft/archived events", async () => {
      const group = await createGroup();
      await createEvent(String(group._id), { status: "draft" });
      expect(await listPublicEventsForGroup(String(group._id))).toHaveLength(0);
    });

    it("never exposes a tDarts partner secret in the public payload", async () => {
      const org = await OrganizationModel.create({
        name: "Magyar Darts Szövetség",
        slug: "magyar-darts-szovetseg",
        settings: { tdarts: { enabled: true, apiBaseUrl: "https://api.tdarts.hu", embedClientId: "embed_abc", partnerClientId: "partner_abc", partnerClientSecretEnc: "enc:v1:should.never.leak" } },
      });
      const group = await createGroup({ organizationId: org._id });
      await createEvent(String(group._id), { tdarts: { enabled: true, tournamentCode: "WDF2026" } });

      const events = await listPublicEventsForGroup(String(group._id));
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain("partnerClientSecretEnc");
      expect(serialized).not.toContain("should.never.leak");
      expect(events[0]?.tdarts).toMatchObject({ tournamentCode: "WDF2026", embedClientId: "embed_abc" });
    });
  });

  describe("getPublicEventDetail", () => {
    it("returns the event and its active hotels", async () => {
      const group = await createGroup();
      const event = await createEvent(String(group._id));
      await HotelModel.create({
        groupId: group._id,
        name: "Hotel Budapest",
        status: "active",
        pricing: { priceBasis: "gross", vatPercent: 27, accommodationMode: "room_nights", roomTypes: [{ key: "double", label: "Double room", baseRateHuf: 20000 }] },
      });

      const detail = await getPublicEventDetail(String(group._id), String(event._id));
      expect(detail?.event.id).toBe(String(event._id));
      expect(detail?.hotels).toHaveLength(1);
      expect(detail?.hotels[0]?.name).toBe("Hotel Budapest");
    });

    it("returns null for an event that belongs to a different group", async () => {
      const group = await createGroup();
      const otherGroup = await createGroup({ name: "Other" });
      const event = await createEvent(String(group._id));
      expect(await getPublicEventDetail(String(otherGroup._id), String(event._id))).toBeNull();
    });

    it("returns null for an inactive event", async () => {
      const group = await createGroup();
      const event = await createEvent(String(group._id), { status: "draft" });
      expect(await getPublicEventDetail(String(group._id), String(event._id))).toBeNull();
    });

    it("omits an inactive hotel from the public listing", async () => {
      const group = await createGroup();
      const event = await createEvent(String(group._id));
      await HotelModel.create({
        groupId: group._id,
        name: "Closed Hotel",
        status: "archived",
        pricing: { priceBasis: "gross", vatPercent: 27, accommodationMode: "room_nights", roomTypes: [{ key: "double", label: "Double room", baseRateHuf: 20000 }] },
      });

      const detail = await getPublicEventDetail(String(group._id), String(event._id));
      expect(detail?.hotels).toHaveLength(0);
    });

    it("omits a fully booked hotel (zero remaining capacity)", async () => {
      const group = await createGroup();
      const event = await createEvent(String(group._id));
      const hotel = await HotelModel.create({
        groupId: group._id,
        name: "Small Hotel",
        status: "active",
        bookingCapacity: 2,
        pricing: { priceBasis: "gross", vatPercent: 27, accommodationMode: "room_nights", roomTypes: [{ key: "double", label: "Double room", baseRateHuf: 20000 }] },
      });
      await BookingModel.create({
        eventId: event._id,
        hotelId: hotel._id,
        eventName: event.name,
        groupName: group.name,
        hotelName: hotel.name,
        customer: { name: "Kovács Anna", email: "anna@example.com", phone: "+36301234567", note: "" },
        attendeeFieldSchema: [],
        guests: 2,
        nights: 2,
        playersPerTicket: 1,
        attendees: [{ fields: {} }, { fields: {} }],
        selections: { roomType: "double" },
        quote: { guests: 2, accommodationGuests: 2, nights: 2, ticketSubtotalHuf: 10_000, accommodationBaseHuf: 40_000, accommodationOptionsHuf: 0, accommodationSubtotalHuf: 40_000, totalHuf: 50_000, lines: [] },
        totalHuf: 50_000,
        currency: "HUF",
        status: "paid",
      });

      const detail = await getPublicEventDetail(String(group._id), String(event._id));
      expect(detail?.hotels).toHaveLength(0);
    });
  });

  describe("day-pass events", () => {
    it("exposes per-day gross prices and what is left, never the sold counts", async () => {
      const group = await createGroup();
      const day = 24 * 60 * 60 * 1000;
      const start = new Date(Date.now() + day);
      const dayKey = (d: Date) => d.toISOString().slice(0, 10);
      await createEvent(String(group._id), {
        kind: "day_pass",
        ticketPriceBasis: "net",
        startDate: start,
        endDate: new Date(start.getTime() + 2 * day),
        dayPass: { weekdayPriceHuf: 1000, weekendPriceHuf: 2000, weekendDays: [6, 0], dailyCapacity: 4, capacityOverrides: {}, closedDays: [dayKey(new Date(start.getTime() + day))] },
        daySold: { [dayKey(start)]: 4 },
      });

      const [event] = await listPublicEventsForGroup(String(group._id));
      expect(event!.kind).toBe("day_pass");
      const days = event!.dayPass!.days;
      expect(days).toHaveLength(3);
      expect(days[0]).toMatchObject({ remaining: 0, bookable: false });
      expect(days[1]).toMatchObject({ closed: true, bookable: false });
      expect(days[2]).toMatchObject({ remaining: 4, bookable: true });
      expect([1270, 2540]).toContain(days[2]!.unitPriceGrossHuf); // 1000/2000 net + 27% VAT, by weekday
      expect(JSON.stringify(event)).not.toContain("daySold");
    });

    it("leaves standard events with dayPass: null", async () => {
      const group = await createGroup();
      await createEvent(String(group._id));
      const [event] = await listPublicEventsForGroup(String(group._id));
      expect(event!.kind).toBe("standard");
      expect(event!.dayPass).toBeNull();
    });
  });

  describe("getPublicEntryList", () => {
    type TeamAttendee = { fields: Record<string, string>; members: Array<{ fields: Record<string, string> }> };
    async function teamBooking(eventId: string, status: "paid" | "pending", attendees: TeamAttendee[], customerName = "Vevő Viktor") {
      return BookingModel.create({
        eventId,
        eventName: "Páros",
        customer: { name: customerName, email: "v@example.com", phone: "+36301234567", note: "" },
        attendeeFieldSchema: [{ key: "csapatnev", label: "Csapatnév", type: "text", required: false, helpText: "", sortOrder: 0 }],
        teamMemberFieldSchema: [{ key: "nev", label: "Név", type: "text", required: true, helpText: "", sortOrder: 0 }],
        guests: attendees.length,
        attendees,
        quote: { guests: 1, accommodationGuests: 0, nights: 0, ticketSubtotalHuf: 0, accommodationBaseHuf: 0, accommodationOptionsHuf: 0, accommodationSubtotalHuf: 0, totalHuf: 0, lines: [] },
        totalHuf: 0,
        status,
      });
    }

    it("lists paid teams with their players, labelled by team name or the buyer", async () => {
      const group = await createGroup();
      const event = await createEvent(String(group._id), { name: "Páros verseny", publicEntryList: true, registrationUnit: "team" });
      await teamBooking(String(event._id), "paid", [
        { fields: { csapatnev: "Nyilasok" }, members: [{ fields: { nev: "Kiss Anna" } }, { fields: { nev: "Nagy Béla" } }] },
        { fields: {}, members: [{ fields: { nev: "Tóth Csaba" } }, { fields: { nev: " " } }] },
      ]);
      await teamBooking(String(event._id), "pending", [{ fields: { csapatnev: "Nem fizetett" }, members: [] }]);

      expect(await getPublicEntryList(String(group._id), String(event._id))).toEqual({
        eventName: "Páros verseny",
        teams: [
          { label: "Nyilasok", members: ["Kiss Anna", "Nagy Béla"] },
          { label: "Vevő Viktor", members: ["Tóth Csaba"] },
        ],
      });
    });

    it("is null unless the event is active, in this group and publishes its list", async () => {
      const group = await createGroup();
      const other = await createGroup();
      const hidden = await createEvent(String(group._id), { publicEntryList: false });
      const listed = await createEvent(String(group._id), { publicEntryList: true });
      const draft = await createEvent(String(group._id), { publicEntryList: true, status: "draft" });
      expect(await getPublicEntryList(String(group._id), String(hidden._id))).toBeNull();
      expect(await getPublicEntryList(String(other._id), String(listed._id))).toBeNull();
      expect(await getPublicEntryList(String(group._id), String(draft._id))).toBeNull();
      expect(await getPublicEntryList(String(group._id), String(listed._id))).toEqual({ eventName: "Első WDF verseny", teams: [] });
    });
  });
});
