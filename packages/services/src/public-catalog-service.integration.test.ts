import { MongoMemoryServer } from "mongodb-memory-server";
import { BookingModel, EventGroupModel, EventModel, HotelModel, OrganizationModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPublicEventDetail, listPublicDirectory, listPublicEventsForGroup } from "./public-catalog-service";

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
});
