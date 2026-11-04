import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseInput } from "@tbook/actions";
import { BookingModel, dbConnect, dbDisconnectAll, VoucherModel } from "@tbook/db";
import { adminEventGroupInputSchema, adminEventInputSchema } from "@tbook/schemas";
import { createEvent, createEventGroup, createOrganization, getEventForOrg, listAllOrganizations, listEventsForOrg, listGroupsForOrg } from "@tbook/services";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runBookingCommand } from "./commands/booking";
import { runEventCommand } from "./commands/event";
import { runGroupCommand } from "./commands/group";

/**
 * Exercises the safety plumbing every future entity will reuse: dry-run by
 * default, the --prod-ack write gate, per-field (not "yes to all")
 * confirmation, scoped restore points, and undo — through the real event
 * and booking commands rather than by testing the plumbing in isolation.
 */
describe("tbook-cli", () => {
  let mongod: MongoMemoryServer;
  let uri: string;
  let orgId: string;
  let groupId: string;
  const backupsCliDir = path.resolve("backups", "cli");
  let backupsCliExistedBefore = false;

  beforeAll(async () => {
    backupsCliExistedBefore = fs.existsSync(backupsCliDir);
    mongod = await MongoMemoryServer.create();
    uri = `${mongod.getUri()}tbook-cli-test`;
    await dbConnect(uri);
  });

  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
    if (!backupsCliExistedBefore) fs.rmSync(backupsCliDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await Promise.all([
      BookingModel.deleteMany({}),
      VoucherModel.deleteMany({}),
    ]);
    const { organization } = await createOrganization({ name: "CLI Test Org", currency: "HUF" });
    orgId = String(organization.id);
    const { group } = await createEventGroup(orgId, parseInput(adminEventGroupInputSchema, { name: "CLI Test Group" }));
    groupId = String(group._id);
  });

  async function seedEvent(overrides: Record<string, unknown> = {}) {
    const input = parseInput(adminEventInputSchema, {
      groupId,
      name: "Seeded Event",
      startDate: "2026-12-01",
      endDate: "2026-12-02",
      ticketFeeHuf: 1000,
      ...overrides,
    });
    return createEvent(orgId, input);
  }

  function findNewestBackupDir(prefix: string): string {
    const entries = fs.readdirSync(backupsCliDir).filter((name) => name.startsWith(prefix));
    if (entries.length === 0) throw new Error(`No backup dir starting with "${prefix}" in ${backupsCliDir}`);
    entries.sort();
    return path.join(backupsCliDir, entries[entries.length - 1] as string);
  }

  describe("event edit", () => {
    it("defaults to a dry run: nothing is written without --apply", async () => {
      const event = await seedEvent();
      await runEventCommand("edit", ["--org", orgId, "--uri", uri, "--id", String(event._id), "--set", "capacity=50"]);

      const after = await getEventForOrg(orgId, String(event._id));
      expect(after.capacity).toBeNull();
    });

    it("refuses --apply without --prod-ack", async () => {
      const event = await seedEvent();
      await expect(
        runEventCommand("edit", ["--org", orgId, "--uri", uri, "--id", String(event._id), "--set", "capacity=50", "--apply"]),
      ).rejects.toThrow(/PRODUCTION/);
    });

    it("refuses a non-interactive apply without naming the changed field", async () => {
      const event = await seedEvent();
      await expect(
        runEventCommand("edit", [
          "--org",
          orgId,
          "--uri",
          uri,
          "--id",
          String(event._id),
          "--set",
          "capacity=50",
          "--apply",
          "--prod-ack",
        ]),
      ).rejects.toThrow(/--confirm-field/);
    });

    it("writes once every field is confirmed, leaves a restore point, and can be undone", async () => {
      const event = await seedEvent();
      const id = String(event._id);

      await runEventCommand("edit", [
        "--org",
        orgId,
        "--uri",
        uri,
        "--id",
        id,
        "--set",
        "capacity=77",
        "--set",
        "name=Renamed Event",
        "--apply",
        "--prod-ack",
        "--confirm-field",
        "capacity",
        "--confirm-field",
        "name",
      ]);

      const edited = await getEventForOrg(orgId, id);
      expect(edited.capacity).toBe(77);
      expect(edited.name).toBe("Renamed Event");

      const dir = findNewestBackupDir(`event-edit-${id}-`);
      const audit = JSON.parse(fs.readFileSync(path.join(dir, "audit.json"), "utf8"));
      expect(audit.action).toBe("edit");
      expect(audit.organizationId).toBe(orgId);
      expect(audit.changes.map((c: { field: string }) => c.field).sort()).toEqual(["capacity", "name"]);
      expect(audit.operator?.name).toBeTruthy();

      await runEventCommand("undo", [
        "--org",
        orgId,
        "--uri",
        uri,
        "--dir",
        dir,
        "--apply",
        "--prod-ack",
        "--confirm-field",
        "capacity",
        "--confirm-field",
        "name",
      ]);

      const restored = await getEventForOrg(orgId, id);
      expect(restored.capacity).toBeNull();
      expect(restored.name).toBe("Seeded Event");
    });

    it("rejects an edit to a field the CLI doesn't expose", async () => {
      const event = await seedEvent();
      await expect(
        runEventCommand("edit", ["--org", orgId, "--uri", uri, "--id", String(event._id), "--set", "pricingRules=[]"]),
      ).rejects.toThrow(/isn't editable/);
    });
  });

  describe("event archive (soft-delete)", () => {
    it("is idempotent, requires typing the event's name back, and is undoable", async () => {
      const event = await seedEvent({ name: "Archive Me", status: "active" });
      const id = String(event._id);

      await expect(
        runEventCommand("archive", ["--org", orgId, "--uri", uri, "--id", id, "--apply", "--prod-ack", "--confirm-field", "status"]),
      ).rejects.toThrow(/--confirm-name/);

      await runEventCommand("archive", [
        "--org",
        orgId,
        "--uri",
        uri,
        "--id",
        id,
        "--apply",
        "--prod-ack",
        "--confirm-field",
        "status",
        "--confirm-name",
        "Archive Me",
      ]);
      expect((await getEventForOrg(orgId, id)).status).toBe("archived");

      // Re-running is a no-op, not an error, and writes nothing new.
      const before = fs.readdirSync(backupsCliDir).length;
      await runEventCommand("archive", ["--org", orgId, "--uri", uri, "--id", id, "--apply", "--prod-ack"]);
      expect(fs.readdirSync(backupsCliDir).length).toBe(before);

      const dir = findNewestBackupDir(`event-archive-${id}-`);
      await runEventCommand("undo", [
        "--org",
        orgId,
        "--uri",
        uri,
        "--dir",
        dir,
        "--apply",
        "--prod-ack",
        "--confirm-field",
        "status",
      ]);
      expect((await getEventForOrg(orgId, id)).status).toBe("active");
    });
  });

  describe("event create", () => {
    it("dry-runs by default, then creates and can be undone (as an archive — no hard delete exists)", async () => {
      const before = (await listEventsForOrg(orgId)).length;
      const createArgs = [
        "--org",
        orgId,
        "--uri",
        uri,
        "--set",
        `groupId=${groupId}`,
        "--set",
        "name=Created via CLI",
        "--set",
        "startDate=2026-12-10",
        "--set",
        "endDate=2026-12-11",
        "--set",
        "ticketFeeHuf=500",
      ];
      await runEventCommand("create", createArgs);
      expect((await listEventsForOrg(orgId)).length).toBe(before);

      await runEventCommand("create", [
        ...createArgs,
        "--apply",
        "--prod-ack",
        "--confirm-field",
        "groupId",
        "--confirm-field",
        "name",
        "--confirm-field",
        "startDate",
        "--confirm-field",
        "endDate",
        "--confirm-field",
        "ticketFeeHuf",
      ]);
      const events = await listEventsForOrg(orgId);
      expect(events.length).toBe(before + 1);
      const created = events.find((e) => e.name === "Created via CLI");
      expect(created).toBeDefined();

      const dir = findNewestBackupDir(`event-create-${String(created?._id)}-`);
      await runEventCommand("undo", [
        "--org",
        orgId,
        "--uri",
        uri,
        "--dir",
        dir,
        "--apply",
        "--prod-ack",
        "--confirm-field",
        "status",
        "--confirm-name",
        "Created via CLI",
      ]);
      expect((await getEventForOrg(orgId, String(created?._id))).status).toBe("archived");
    });
  });

  describe("event create --day-pass-json", () => {
    it("sets the full dayPass config (prices, schedule, discount codes) from a JSON file", async () => {
      const dayPass = {
        weekdayPriceHuf: 6000,
        weekendPriceHuf: 8000,
        weekendDays: [6, 0],
        dailyCapacity: null,
        capacityOverrides: {},
        closedDays: ["2026-12-07", "2026-12-08"],
        weekdaySchedule: { openTime: "14:00", closeTime: "20:00" },
        weekendSchedule: { openTime: "11:00", closeTime: "20:00" },
        discountCodes: [{ code: "10", label: "10% kedvezmény", percentOff: 10, enabled: true }],
      };
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tbook-cli-test-")), "day-pass.json");
      fs.writeFileSync(file, JSON.stringify(dayPass));

      const createArgs = [
        "--org",
        orgId,
        "--uri",
        uri,
        "--set",
        `groupId=${groupId}`,
        "--set",
        "name=Day Pass via CLI",
        "--set",
        "startDate=2026-12-01",
        "--set",
        "endDate=2026-12-10",
        "--set",
        "ticketFeeHuf=0",
        "--set",
        "kind=day_pass",
        "--day-pass-json",
        file,
        "--apply",
        "--prod-ack",
        "--confirm-field",
        "groupId",
        "--confirm-field",
        "name",
        "--confirm-field",
        "startDate",
        "--confirm-field",
        "endDate",
        "--confirm-field",
        "ticketFeeHuf",
        "--confirm-field",
        "kind",
        "--confirm-field",
        "dayPass",
      ];
      await runEventCommand("create", createArgs);

      const events = await listEventsForOrg(orgId);
      const created = events.find((e) => e.name === "Day Pass via CLI");
      expect(created).toBeDefined();
      expect(created?.kind).toBe("day_pass");
      expect(created?.dayPass?.weekdayPriceHuf).toBe(6000);
      expect(created?.dayPass?.weekendPriceHuf).toBe(8000);
      expect(created?.dayPass?.closedDays).toEqual(["2026-12-07", "2026-12-08"]);
      expect(created?.dayPass?.weekdaySchedule).toMatchObject({ openTime: "14:00", closeTime: "20:00" });
      expect(created?.dayPass?.discountCodes).toHaveLength(1);
      expect(created?.dayPass?.discountCodes[0]?.percentOff).toBe(10);
    });

    it("rejects a --day-pass-json file that isn't valid JSON", async () => {
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tbook-cli-test-")), "bad.json");
      fs.writeFileSync(file, "{ not json");
      await expect(
        runEventCommand("create", [
          "--org",
          orgId,
          "--uri",
          uri,
          "--set",
          `groupId=${groupId}`,
          "--set",
          "name=X",
          "--set",
          "startDate=2026-12-01",
          "--set",
          "endDate=2026-12-02",
          "--set",
          "ticketFeeHuf=0",
          "--day-pass-json",
          file,
        ]),
      ).rejects.toThrow(/not valid JSON/);
    });
  });

  describe("event list/show", () => {
    it("lists and shows without needing --apply or --prod-ack", async () => {
      await seedEvent({ name: "Listed Event" });
      await expect(runEventCommand("list", ["--org", orgId, "--uri", uri])).resolves.toBeUndefined();
      const event = await seedEvent({ name: "Shown Event" });
      await expect(runEventCommand("show", ["--org", orgId, "--uri", uri, "--id", String(event._id)])).resolves.toBeUndefined();
    });
  });

  describe("--org resolution", () => {
    it("refuses an org id/slug that doesn't exist", async () => {
      await expect(runEventCommand("list", ["--org", "does-not-exist", "--uri", uri])).rejects.toThrow(/No organization matches/);
    });

    it("accepts the org's slug as well as its id", async () => {
      const orgs = await listAllOrganizations();
      const org = orgs.find((o) => o.id === orgId);
      expect(org).toBeDefined();
      await expect(runEventCommand("list", ["--org", org?.slug ?? "", "--uri", uri])).resolves.toBeUndefined();
    });
  });

  describe("booking resend-voucher", () => {
    async function seedBookingWithVoucher() {
      const event = await seedEvent({ name: "Resend Event", status: "active" });
      const booking = await BookingModel.create({
        organizationId: new Types.ObjectId(orgId),
        groupId: new Types.ObjectId(groupId),
        eventId: event._id,
        eventName: event.name,
        groupName: "CLI Test Group",
        customer: { name: "Jane Doe", email: "jane@example.com", phone: "+36301234567" },
        guests: 1,
        quote: { guests: 1, ticketSubtotalHuf: 1000, totalHuf: 1000 },
        totalHuf: 1000,
        status: "paid",
      });
      await VoucherModel.create({
        eventId: event._id,
        bookingId: booking._id,
        attendeeIndex: 0,
        token: `tok-${String(booking._id)}`,
        displayName: "Jane Doe",
        eventSnapshot: { name: event.name, startDate: event.startDate, endDate: event.endDate },
      });
      return booking;
    }

    it("dry-runs without needing --prod-ack", async () => {
      const booking = await seedBookingWithVoucher();
      await expect(
        runBookingCommand("resend-voucher", ["--org", orgId, "--uri", uri, "--id", String(booking._id)]),
      ).resolves.toBeUndefined();
    });

    it("refuses --apply without the typed confirmation phrase, before touching any mail transport", async () => {
      const booking = await seedBookingWithVoucher();
      await expect(
        runBookingCommand("resend-voucher", ["--org", orgId, "--uri", uri, "--id", String(booking._id), "--apply", "--prod-ack"]),
      ).rejects.toThrow(/--confirm-send/);
    });
  });

  describe("group edit", () => {
    it("dry-runs by default, then writes once confirmed, e.g. to publish a draft group", async () => {
      await runGroupCommand("edit", ["--org", orgId, "--uri", uri, "--id", groupId, "--set", "status=active"]);
      expect((await listGroupsForOrg(orgId)).find((g) => String(g._id) === groupId)?.status).toBe("draft");

      await runGroupCommand("edit", [
        "--org",
        orgId,
        "--uri",
        uri,
        "--id",
        groupId,
        "--set",
        "status=active",
        "--apply",
        "--prod-ack",
        "--confirm-field",
        "status",
      ]);

      expect((await listGroupsForOrg(orgId)).find((g) => String(g._id) === groupId)?.status).toBe("active");
    });

    it("rejects an edit to a field the CLI doesn't expose", async () => {
      await expect(
        runGroupCommand("edit", ["--org", orgId, "--uri", uri, "--id", groupId, "--set", "apiKeyHash=x"]),
      ).rejects.toThrow(/isn't editable/);
    });
  });
});
