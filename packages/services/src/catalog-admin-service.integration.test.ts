import { MongoMemoryServer } from "mongodb-memory-server";
import { EventGroupModel, EventModel, HotelModel, OrganizationModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createEvent,
  createEventGroup,
  createHotel,
  getEventForOrg,
  listEventsForOrg,
  listHotelsForOrg,
  rotateEventGroupApiKey,
  updateEvent,
  updateHotel,
} from "./catalog-admin-service";
import { verifyApiKey } from "./api-key";

const eventInput = (groupId: string) => ({
  groupId,
  name: "Open",
  description: "",
  address: "Budapest",
  startDate: new Date("2026-07-01"),
  endDate: new Date("2026-07-03"),
  startTime: null,
  endTime: null,
  salesOpensAt: null,
  salesClosesAt: null,
  currency: "HUF",
  ticketFeeHuf: 10000,
  ticketFeeMode: "per_person" as const,
  registrationUnit: "person" as const,
  playersPerTicket: 1,
  ticketPriceBasis: "net" as const,
  ticketVatPercent: 27,
  capacity: 10 as number | null,
  vouchersEnabled: true,
  publicListing: "listed" as const,
  status: "active" as const,
  tdartsEnabled: false,
  tdartsTournamentCode: null,
});

describe("catalog-admin-service", () => {
  let mongod: MongoMemoryServer;
  let orgId: string;
  let otherOrgId: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
  });
  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });
  beforeEach(async () => {
    await Promise.all([EventModel.deleteMany({}), EventGroupModel.deleteMany({}), HotelModel.deleteMany({}), OrganizationModel.deleteMany({})]);
    orgId = String((await OrganizationModel.create({ name: "A", slug: "a", status: "active" }))._id);
    otherOrgId = String((await OrganizationModel.create({ name: "B", slug: "b", status: "active" }))._id);
  });

  const newGroup = (org: string) =>
    createEventGroup(org, {
      name: "WDF",
      description: "",
      status: "active",
      defaultPriceBasis: "net",
      defaultVatPercent: 27,
      listOnTBookSite: false,
      listingTitle: "",
      listingUrl: "",
    });

  it("creates a group whose plaintext key verifies against the stored hash, and rotation invalidates it", async () => {
    const { group, apiKey } = await newGroup(orgId);
    expect(verifyApiKey(apiKey, group.apiKeyHash)).toBe(true);

    const { apiKey: next } = await rotateEventGroupApiKey(orgId, String(group._id));
    const reloaded = await EventGroupModel.findById(group._id);
    expect(verifyApiKey(apiKey, reloaded!.apiKeyHash)).toBe(false);
    expect(verifyApiKey(next, reloaded!.apiKeyHash)).toBe(true);
  });

  it("refuses to touch another org's group, event or hotel", async () => {
    const { group } = await newGroup(otherOrgId);
    await expect(createEvent(orgId, eventInput(String(group._id)))).rejects.toThrow(/not found/i);
    await expect(rotateEventGroupApiKey(orgId, String(group._id))).rejects.toThrow(/not found/i);

    const foreignEvent = await createEvent(otherOrgId, eventInput(String(group._id)));
    await expect(getEventForOrg(orgId, String(foreignEvent._id))).rejects.toThrow(/not found/i);
    expect(await listEventsForOrg(orgId)).toHaveLength(0);
  });

  it("finds legacy events that carry only a groupId", async () => {
    const { group } = await newGroup(orgId);
    await EventModel.create({ ...eventInput(String(group._id)), groupId: group._id, ticketFeeHuf: 1 });
    expect(await listEventsForOrg(orgId)).toHaveLength(1);
  });

  it("won't lower capacity below what is already sold", async () => {
    const { group } = await newGroup(orgId);
    const event = await createEvent(orgId, eventInput(String(group._id)));
    await EventModel.updateOne({ _id: event._id }, { soldGuestCount: 6 });

    await expect(updateEvent(orgId, String(event._id), { ...eventInput(String(group._id)), capacity: 5 })).rejects.toThrow(/already sold/);
    const ok = await updateEvent(orgId, String(event._id), { ...eventInput(String(group._id)), capacity: 6, name: "Renamed" });
    expect(ok.name).toBe("Renamed");
    expect(ok.location.address).toBe("Budapest");
  });

  it("keeps unedited pricing fields when a hotel is saved", async () => {
    const { group } = await newGroup(orgId);
    const input = {
      groupId: String(group._id),
      name: "Hotel",
      description: "",
      address: "",
      distanceFromVenueKm: null,
      contactEmail: "",
      contactPhone: "",
      currency: "HUF",
      bookingCapacity: null,
      roomInventory: null,
      status: "active" as const,
      priceBasis: "net" as const,
      vatPercent: 27,
      roomTypes: [{ key: "dbl", label: "Double", baseRateHuf: 30000, sortOrder: 0 }],
      packages: [],
    };
    const hotel = await createHotel(orgId, input);
    await HotelModel.updateOne({ _id: hotel._id }, { "pricing.extrasSection": { label: "Extras", description: "", options: [] } });

    const updated = await updateHotel(orgId, String(hotel._id), { ...input, name: "Hotel 2" });
    expect(updated.pricing.extrasSection?.label).toBe("Extras");
    expect(updated.pricing.roomTypes).toHaveLength(1);
    expect(await listHotelsForOrg(orgId)).toHaveLength(1);
    expect(await listHotelsForOrg(otherOrgId)).toHaveLength(0);
  });
});
