import { MongoMemoryServer } from "mongodb-memory-server";
import { BookingModel, EventModel, OrganizationModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptOrgSecret } from "./org-secrets";
import { syncBookingToTDarts } from "./tdarts-sync-service";

async function createOrg() {
  return OrganizationModel.create({
    name: "Magyar Darts Szövetség",
    slug: "magyar-darts-szovetseg",
    settings: { tdarts: { enabled: true, apiBaseUrl: "https://api.tdarts.hu", embedClientId: "embed", partnerClientId: "client-1", partnerClientSecretEnc: encryptOrgSecret("partner-secret") } },
  });
}

async function createEvent(organizationId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return EventModel.create({
    organizationId,
    name: "Első WDF verseny",
    status: "active",
    startDate: new Date(),
    endDate: new Date(),
    ticketFeeHuf: 5000,
    tdarts: { enabled: true, tournamentCode: "WDF2026" },
    ...overrides,
  });
}

async function createBooking(organizationId: string, eventId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return BookingModel.create({
    organizationId,
    eventId,
    eventName: "Első WDF verseny",
    groupName: "",
    hotelName: "",
    customer: { name: "Kovács Anna", email: "anna@example.com", phone: "+36301234567", note: "" },
    attendeeFieldSchema: [{ key: "fullName", label: "Név", type: "text", required: true, helpText: "", sortOrder: 0 }, { key: "email", label: "Email", type: "email", required: true, helpText: "", sortOrder: 1 }],
    guests: 1,
    nights: 0,
    playersPerTicket: 1,
    attendees: [{ fields: { fullName: "Kiss Béla", email: "bela@example.com" } }],
    selections: {},
    quote: { guests: 1, nights: 0, ticketSubtotalHuf: 5000, accommodationBaseHuf: 0, accommodationOptionsHuf: 0, accommodationSubtotalHuf: 0, totalHuf: 5000, lines: [] },
    totalHuf: 5000,
    currency: "HUF",
    status: "paid",
    ...overrides,
  });
}

function jsonFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe("syncBookingToTDarts", () => {
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
    await Promise.all([OrganizationModel.deleteMany({}), EventModel.deleteMany({}), BookingModel.deleteMany({})]);
  });

  it("enrolls a solo attendee and records the sync result", async () => {
    const org = await createOrg();
    const event = await createEvent(String(org._id));
    const booking = await createBooking(String(org._id), String(event._id));
    const fetchImpl = jsonFetch({ playerId: "p1", rosterStatus: "applied" });

    await syncBookingToTDarts(String(booking._id), { fetchImpl });

    const reloaded = await BookingModel.findById(booking._id).exec();
    expect(reloaded?.tdartsSync).toHaveLength(1);
    expect(reloaded?.tdartsSync[0]).toMatchObject({ status: "synced", playerId: "p1" });
  });

  it("refuses to enroll a participant whose name/email fell back to the buyer's contact", async () => {
    const org = await createOrg();
    const event = await createEvent(String(org._id));
    const booking = await createBooking(String(org._id), String(event._id), { attendees: [{ fields: {} }] });
    const fetchImpl = jsonFetch({ playerId: "p1", rosterStatus: "applied" });

    await syncBookingToTDarts(String(booking._id), { fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
    const reloaded = await BookingModel.findById(booking._id).exec();
    expect(reloaded?.tdartsSync[0]?.status).toBe("failed");
  });

  it("enrolls a doubles ticket via the pair endpoint when teamMemberLimit is 2", async () => {
    const org = await createOrg();
    const event = await createEvent(String(org._id), { registrationUnit: "team", teamMemberLimit: 2 });
    const booking = await createBooking(String(org._id), String(event._id), {
      teamMemberFieldSchema: [{ key: "fullName", label: "Név", type: "text", required: true, helpText: "", sortOrder: 0 }, { key: "email", label: "Email", type: "email", required: true, helpText: "", sortOrder: 1 }],
      attendees: [{ fields: {}, members: [{ fields: { fullName: "A", email: "a@example.com" } }, { fields: { fullName: "B", email: "b@example.com" } }] }],
    });
    const fetchImpl = jsonFetch({ pairPlayerId: "pp1", rosterStatus: "applied" });

    await syncBookingToTDarts(String(booking._id), { fetchImpl });

    const reloaded = await BookingModel.findById(booking._id).exec();
    expect(reloaded?.tdartsSync[0]).toMatchObject({ status: "synced", playerId: "pp1" });
  });

  it("skips (never calls the API for) team tournaments with more than 2 roster slots", async () => {
    const org = await createOrg();
    const event = await createEvent(String(org._id), { registrationUnit: "team", teamMemberLimit: 4 });
    const booking = await createBooking(String(org._id), String(event._id), { attendees: [{ fields: {}, members: [] }] });
    const fetchImpl = jsonFetch({});

    await syncBookingToTDarts(String(booking._id), { fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
    const reloaded = await BookingModel.findById(booking._id).exec();
    expect(reloaded?.tdartsSync[0]?.status).toBe("skipped");
  });

  it("no-ops when the event has tDarts disabled", async () => {
    const org = await createOrg();
    const event = await createEvent(String(org._id), { tdarts: { enabled: false, tournamentCode: null } });
    const booking = await createBooking(String(org._id), String(event._id));
    const fetchImpl = jsonFetch({});

    await syncBookingToTDarts(String(booking._id), { fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
    const reloaded = await BookingModel.findById(booking._id).exec();
    expect(reloaded?.tdartsSync).toHaveLength(0);
  });

  it("no-ops when the organization has no tDarts credentials configured", async () => {
    const org = await OrganizationModel.create({ name: "No Creds Org", slug: "no-creds-org" });
    const event = await createEvent(String(org._id));
    const booking = await createBooking(String(org._id), String(event._id));
    const fetchImpl = jsonFetch({});

    await syncBookingToTDarts(String(booking._id), { fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("records a failed entry (never throws) when the partner API call fails", async () => {
    const org = await createOrg();
    const event = await createEvent(String(org._id));
    const booking = await createBooking(String(org._id), String(event._id));
    const fetchImpl = jsonFetch({ error: "Tournament closed" }, 409);

    await expect(syncBookingToTDarts(String(booking._id), { fetchImpl })).resolves.toBeUndefined();

    const reloaded = await BookingModel.findById(booking._id).exec();
    expect(reloaded?.tdartsSync[0]).toMatchObject({ status: "failed", error: "Tournament closed" });
  });
});
