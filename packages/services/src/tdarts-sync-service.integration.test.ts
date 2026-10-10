import { MongoMemoryServer } from "mongodb-memory-server";
import { BookingModel, EventModel, OrganizationModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptOrgSecret } from "./org-secrets";
import { resyncBookingTeamsToTDarts, syncBookingToTDarts, withdrawBookingFromTDarts } from "./tdarts-sync-service";

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

  const memberSchema = [
    { key: "fullName", label: "Név", type: "text", required: true, helpText: "", sortOrder: 0 },
    { key: "email", label: "Email", type: "email", required: false, helpText: "", sortOrder: 1 },
  ];
  const fourPlayers = [
    { fields: { fullName: "Kiss Anna", email: "" } },
    { fields: { fullName: "Nagy Béla", email: "Bela@Example.com" } },
    { fields: { fullName: "Tóth Cili", email: "cili@example.com" } },
    { fields: { fullName: "Vas Dani", email: "" } },
  ];

  async function createTeamBooking(overrides: Partial<Record<string, unknown>> = {}) {
    const org = await createOrg();
    const event = await createEvent(String(org._id), { registrationUnit: "team", teamMemberLimit: 8 });
    const booking = await createBooking(String(org._id), String(event._id), {
      attendeeFieldSchema: [{ key: "team", label: "Csapatnév", type: "text", required: false, helpText: "", sortOrder: 0 }],
      teamMemberFieldSchema: memberSchema,
      teamMemberLimit: 8,
      attendees: [{ fields: { team: "Bulls SE" }, members: fourPlayers }],
      ...overrides,
    });
    return { org, event, booking };
  }

  // Old expectation: a team with more than 2 roster slots was marked "skipped"
  // and never sent, because tDarts had no team endpoint. It has one now.
  it("enrolls a 4-player team ticket as one tDarts team; a retry is a no-op on tDarts' side", async () => {
    const { booking } = await createTeamBooking();
    const fetchImpl = jsonFetch({ teamPlayerId: "team-1", rosterStatus: "applied" });

    await syncBookingToTDarts(String(booking._id), { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.tdarts.hu/partner/tournaments/WDF2026/enroll-team");
    const body = JSON.parse(init.body as string);
    expect(body.teamName).toBe("Bulls SE");
    expect(body.orderId).toBe(`${String(booking._id)}:0`);
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(body.orderId);
    // The first member with their own email is the contact; nobody gets the buyer's address.
    expect(body.members.map((m: { name: string }) => m.name)).toEqual(["Nagy Béla", "Kiss Anna", "Tóth Cili", "Vas Dani"]);
    expect(body.members.map((m: { email?: string }) => m.email)).toEqual(["bela@example.com", undefined, "cili@example.com", undefined]);
    expect(JSON.stringify(body)).not.toContain("anna@example.com");

    const reloaded = await BookingModel.findById(booking._id).exec();
    expect(reloaded?.tdartsSync).toHaveLength(1);
    expect(reloaded?.tdartsSync[0]).toMatchObject({ status: "synced", playerId: "team-1" });

    // Same orderId on the retry: tDarts answers with the first result and creates nothing.
    await syncBookingToTDarts(String(booking._id), { fetchImpl });
    const retryBody = JSON.parse((fetchImpl.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(retryBody.orderId).toBe(body.orderId);
  });

  it("refuses a team with a blank member name, and one where nobody has an email — without calling tDarts", async () => {
    const blankName = await createTeamBooking({
      attendees: [{ fields: {}, members: [...fourPlayers.slice(0, 3), { fields: { fullName: "", email: "" } }] }],
    });
    const fetchImpl = jsonFetch({ teamPlayerId: "team-1", rosterStatus: "applied" });
    await syncBookingToTDarts(String(blankName.booking._id), { fetchImpl });
    let reloaded = await BookingModel.findById(blankName.booking._id).exec();
    expect(reloaded?.tdartsSync[0]).toMatchObject({ status: "failed" });
    expect(reloaded?.tdartsSync[0]?.error).toContain("Team member 4 has no name");

    await Promise.all([OrganizationModel.deleteMany({}), EventModel.deleteMany({})]);
    const noEmail = await createTeamBooking({
      attendees: [{ fields: {}, members: fourPlayers.map((m) => ({ fields: { ...m.fields, email: "" } })) }],
    });
    await syncBookingToTDarts(String(noEmail.booking._id), { fetchImpl });
    reloaded = await BookingModel.findById(noEmail.booking._id).exec();
    expect(reloaded?.tdartsSync[0]?.error).toContain("No team member has an email");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("pushes an edited roster to tDarts and keeps the entry when tDarts refuses the edit", async () => {
    const { booking } = await createTeamBooking({
      tdartsSync: [{ participantKey: "0", tournamentCode: "WDF2026", status: "synced", playerId: "team-1", rosterStatus: "applied", syncedAt: new Date() }],
    });
    const ok = jsonFetch({ updated: ["members"] });
    await expect(resyncBookingTeamsToTDarts(String(booking._id), { fetchImpl: ok })).resolves.toEqual({ amended: 1, failed: 0 });
    const [url, init] = ok.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.tdarts.hu/partner/tournaments/WDF2026/enrollments/${encodeURIComponent(`${String(booking._id)}:0`)}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toMatchObject({ orderId: `${String(booking._id)}:0`, teamName: "Bulls SE" });

    const refused = jsonFetch({ error: "Cannot remove Kiss Anna: already on a lineup of this tournament", code: "PLAYER_ALREADY_PLAYED" }, 422);
    await expect(resyncBookingTeamsToTDarts(String(booking._id), { fetchImpl: refused })).resolves.toEqual({ amended: 0, failed: 1 });
    const reloaded = await BookingModel.findById(booking._id).exec();
    // Still enrolled on tDarts as before — only the reason the edit did not land is recorded.
    expect(reloaded?.tdartsSync[0]).toMatchObject({ status: "synced", playerId: "team-1" });
    expect(reloaded?.tdartsSync[0]?.error).toContain("[PLAYER_ALREADY_PLAYED]");
  });

  it("withdraws a cancelled team, and records it when tDarts will not release the place", async () => {
    const { booking } = await createTeamBooking({
      tdartsSync: [{ participantKey: "0", tournamentCode: "WDF2026", status: "synced", playerId: "team-1", rosterStatus: "applied", syncedAt: new Date() }],
    });
    const drawn = jsonFetch({ error: "A team can only be withdrawn before the first stage is drawn", code: "DRAW_ALREADY_MADE" }, 422);
    await expect(withdrawBookingFromTDarts(String(booking._id), { fetchImpl: drawn })).resolves.toEqual({ withdrawn: 0, failed: 1 });
    let reloaded = await BookingModel.findById(booking._id).exec();
    expect(reloaded?.tdartsSync[0]).toMatchObject({ status: "synced" });
    expect(reloaded?.tdartsSync[0]?.error).toContain("[DRAW_ALREADY_MADE]");

    const ok = jsonFetch({ withdrawnNow: true, promotedEntrantId: null });
    await expect(withdrawBookingFromTDarts(String(booking._id), { fetchImpl: ok })).resolves.toEqual({ withdrawn: 1, failed: 0 });
    const [url, init] = ok.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/enrollments\/.+\/withdraw$/);
    expect(JSON.parse(init.body as string)).toEqual({ orderId: `${String(booking._id)}:0` });
    reloaded = await BookingModel.findById(booking._id).exec();
    expect(reloaded?.tdartsSync[0]).toMatchObject({ status: "withdrawn", error: null });

    // Nothing left to withdraw: no second call.
    await expect(withdrawBookingFromTDarts(String(booking._id), { fetchImpl: ok })).resolves.toEqual({ withdrawn: 0, failed: 0 });
    expect(ok).toHaveBeenCalledTimes(1);
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
