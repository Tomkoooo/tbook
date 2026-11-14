import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventModel, OrganizationModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { busTransport } from "@tbook/modules";
import { createOrganization } from "@tbook/services";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runSetupCommand } from "./commands/setup";

/**
 * `setup apply --update` with `busRoutes`: buses upserted by code (stops
 * included), booked seats and console-set captains kept, buses missing
 * from the plan left alone, dry run first; guest-portal's
 * showContactUnmasked accepted from the plan.
 */
describe("tbook-cli setup: bus routes", () => {
  let mongod: MongoMemoryServer;
  let uri: string;
  let orgSlug: string;
  let orgId: string;
  let dir: string;
  let base: Record<string, unknown>;
  const backupsCliDir = path.resolve("backups", "cli");
  let backupsCliExistedBefore = false;

  const writePlan = (busRoutes: unknown[], extra: Record<string, unknown> = {}) => {
    const file = path.join(dir, `plan-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(file, JSON.stringify({ ...base, ...extra, busRoutes }));
    return file;
  };
  const run = (file: string, ...more: string[]) => runSetupCommand("apply", ["--org", orgSlug, "--plan", file, "--uri", uri, ...more]);
  const apply = (file: string) => run(file, "--update", "--apply", "--prod-ack", "--confirm", "UPDATE");
  const printed = () => vi.mocked(console.log).mock.calls.flat().join("\n");

  const b01 = {
    code: "B01",
    city: "Szombathely–Győr–Tatabánya",
    capacity: 50,
    returnInfo: "A buszkapitány egyezteti.",
    sortOrder: 1,
    stops: [
      { city: "Szombathely", pickupPoint: "Rákóczi utca 23.", departureAt: "2026-12-04T13:30:00+01:00" },
      { city: "Győr", pickupPoint: "Puskás Tivadar utca 37.", departureAt: "2026-12-04T15:00:00+01:00" },
      { city: "Tatabánya", pickupPoint: "Eötvös utca 1.", departureAt: "2026-12-04T16:00" },
    ],
  };

  beforeAll(async () => {
    backupsCliExistedBefore = fs.existsSync(backupsCliDir);
    mongod = await MongoMemoryServer.create();
    uri = `${mongod.getUri()}tbook-setup-bus-test`;
    await dbConnect(uri);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { organization } = await createOrganization({ name: "Eventstructure Bus Test", currency: "HUF" });
    orgId = String(organization.id);
    orgSlug = (await OrganizationModel.findById(orgId))!.slug;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tbook-setup-bus-"));
    const csv = path.join(dir, "dso.csv");
    fs.writeFileSync(csv, "Dolgozó;Név;Vállalat;E-mail cím\n60000001;Teszt Elek;DHEL;teszt@example.com\n");
    base = JSON.parse(fs.readFileSync(path.resolve("docs/plans/halozatok-unnepe-2026.setup.json"), "utf8"));
    (base.dataLists as Array<{ file: string }>)[0]!.file = csv;
    base.emails = [];
    base.eventModules = { ...(base.eventModules as object), "guest-portal": { enabled: true, config: { showContactUnmasked: true } } };
    await run(writePlan([]), "--apply", "--prod-ack", "--confirm", "SETUP");
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await dbDisconnectAll();
    await mongod?.stop();
    if (!backupsCliExistedBefore) {
      fs.rmSync(backupsCliDir, { recursive: true, force: true });
      return;
    }
    for (const entry of fs.readdirSync(backupsCliDir)) {
      const audit = path.join(backupsCliDir, entry, "audit.json");
      if (fs.existsSync(audit) && JSON.parse(fs.readFileSync(audit, "utf8")).organizationId === orgId) fs.rmSync(path.join(backupsCliDir, entry), { recursive: true, force: true });
    }
  });

  const eventId = async () => String((await EventModel.findOne({ organizationId: orgId }))!._id);

  it("accepts showContactUnmasked: true from the plan", async () => {
    const event = (await EventModel.findOne({ organizationId: orgId }).lean())!;
    // Stored as given on create; --update stores the select's "yes" (both mean unmasked).
    expect(["yes", true]).toContain((event.modules as Record<string, { config?: Record<string, unknown> }>)["guest-portal"]?.config?.showContactUnmasked);
  });

  it("refuses a bus with a bad stop time or a duplicate code", async () => {
    await expect(run(writePlan([{ ...b01, stops: [{ city: "X", departureAt: "13:30" }] }]), "--update")).rejects.toThrow(/ISO date-time/);
    await expect(run(writePlan([b01, b01]), "--update")).rejects.toThrow(/appears twice/);
  });

  it("creates buses with stops (dry run first), then updates by code without touching seats, captains or other buses", async () => {
    const id = await eventId();
    // A bus made in the console, not in the plan.
    await busTransport.createRoute(orgId, id, { code: "X9", city: "Kézi", capacity: 10 });

    vi.mocked(console.log).mockClear();
    const first = writePlan([b01, { code: "B02", city: "Baja", capacity: 49, stops: [{ city: "Baja", pickupPoint: "Fő tér", departureAt: "2026-12-04T15:10:00+01:00" }] }]);
    await run(first, "--update");
    expect(printed()).toMatch(/Bus B01: create/);
    expect(printed()).toMatch(/Buses not in the plan \(left as they are\): X9/);
    expect(printed()).toMatch(/DRY RUN/);
    expect(await busTransport.BusRouteModel.countDocuments({ eventId: id })).toBe(1);

    await apply(first);
    const routes = await busTransport.listRoutes(id);
    expect(routes.map((r) => r.code).sort()).toEqual(["B01", "B02", "X9"]);
    const created = routes.find((r) => r.code === "B01")!;
    expect(busTransport.routeStops(created).map((s) => [s.city, s.departureAt?.toISOString()])).toEqual([
      ["Szombathely", "2026-12-04T12:30:00.000Z"],
      ["Győr", "2026-12-04T14:00:00.000Z"],
      // No offset = Budapest time.
      ["Tatabánya", "2026-12-04T15:00:00.000Z"],
    ]);
    expect(created).toMatchObject({ capacity: 50, pickupPoint: "Rákóczi utca 23.", returnInfo: "A buszkapitány egyezteti.", active: true });

    // Guests booked 3 seats; the captain was entered in the console.
    await busTransport.BusRouteModel.updateOne({ _id: created._id }, { $set: { seatsTaken: 3, captainName: "Busz Béla", captainPhone: "+36 20 111 2222" } });

    vi.mocked(console.log).mockClear();
    const second = writePlan([{ ...b01, capacity: 52, captainName: "", stops: [...b01.stops, { city: "Budaörs", pickupPoint: "Benzinkút", departureAt: "2026-12-04T16:40:00+01:00" }] }]);
    await apply(second);
    expect(printed()).toMatch(/Bus B01: update/);
    expect(printed()).toMatch(/capacity: 50 -> 52/);
    expect(printed()).toMatch(/Budaörs/);
    const updated = (await busTransport.BusRouteModel.findById(created._id))!;
    expect(updated).toMatchObject({ capacity: 52, seatsTaken: 3, captainName: "Busz Béla", captainPhone: "+36 20 111 2222" });
    expect(updated.stops).toHaveLength(4);
    // B02 and X9 are not in this plan: untouched, not deleted.
    expect((await busTransport.listRoutes(id)).map((r) => r.code).sort()).toEqual(["B01", "B02", "X9"]);

    vi.mocked(console.log).mockClear();
    await apply(second);
    expect(printed()).toMatch(/Nothing to change/);

    // Below the booked seats: refused before writing.
    await expect(run(writePlan([{ ...b01, capacity: 2 }]), "--update")).rejects.toThrow(/3 seats are booked/);
  });
});
