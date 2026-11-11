import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DataListModel, DataListRowModel, EventGroupModel, EventModel, OrganizationModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { eventEmails } from "@tbook/modules";
import { createBookingWithCheckout, createOrganization } from "@tbook/services";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runSetupCommand } from "./commands/setup";

/**
 * `setup apply` with the real Hálózatok Ünnepe plan, against a small
 * stand-in staff list: dry run writes nothing; apply grants the modules,
 * imports the list, creates group/event/emails, and a free registration
 * with a listed employee ID goes through.
 */
describe("tbook-cli setup apply", () => {
  let mongod: MongoMemoryServer;
  let uri: string;
  let orgSlug: string;
  let orgId: string;
  let planFile: string;
  const backupsCliDir = path.resolve("backups", "cli");
  let backupsCliExistedBefore = false;

  beforeAll(async () => {
    backupsCliExistedBefore = fs.existsSync(backupsCliDir);
    mongod = await MongoMemoryServer.create();
    uri = `${mongod.getUri()}tbook-setup-test`;
    await dbConnect(uri);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { organization } = await createOrganization({ name: "Eventstructure Test", currency: "HUF" });
    orgId = String(organization.id);
    orgSlug = (await OrganizationModel.findById(orgId))!.slug;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tbook-setup-"));
    const csv = path.join(dir, "dso.csv");
    fs.writeFileSync(csv, "Dolgozó;Név;Vállalat;E-mail cím\n60000001;Szőke Tibor;DHEL;szoke@example.com\n60000003;Benkő László;EHEL;benko@example.com\n");
    const plan = JSON.parse(fs.readFileSync(path.resolve("docs/plans/halozatok-unnepe-2026.setup.json"), "utf8"));
    plan.dataLists[0].file = csv;
    // Open now, so the test can register.
    plan.event.status = "active";
    plan.event.salesOpensAt = null;
    plan.event.salesClosesAt = null;
    planFile = path.join(dir, "plan.json");
    fs.writeFileSync(planFile, JSON.stringify(plan));
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await dbDisconnectAll();
    await mongod?.stop();
    if (!backupsCliExistedBefore) {
      fs.rmSync(backupsCliDir, { recursive: true, force: true });
      return;
    }
    // Keep real restore points; drop the ones this test wrote.
    for (const entry of fs.readdirSync(backupsCliDir)) {
      const audit = path.join(backupsCliDir, entry, "audit.json");
      if (fs.existsSync(audit) && JSON.parse(fs.readFileSync(audit, "utf8")).organizationId === orgId) {
        fs.rmSync(path.join(backupsCliDir, entry), { recursive: true, force: true });
      }
    }
  });

  it("dry run validates and writes nothing", async () => {
    await runSetupCommand("apply", ["--org", orgSlug, "--plan", planFile, "--uri", uri]);
    expect(await EventModel.countDocuments({})).toBe(0);
    expect(await DataListModel.countDocuments({})).toBe(0);
    expect((await OrganizationModel.findById(orgId))?.modules ?? {}).toEqual({});
  });

  it("refuses to write without the confirmation phrase", async () => {
    await expect(runSetupCommand("apply", ["--org", orgSlug, "--plan", planFile, "--uri", uri, "--apply", "--prod-ack"])).rejects.toThrow(/SETUP/);
    expect(await EventModel.countDocuments({})).toBe(0);
  });

  it("applies the plan, and the configured registration works", async () => {
    await runSetupCommand("apply", ["--org", orgSlug, "--plan", planFile, "--uri", uri, "--apply", "--prod-ack", "--confirm", "SETUP"]);

    const org = await OrganizationModel.findById(orgId).lean();
    expect(Object.keys(org?.modules ?? {}).sort()).toEqual(["bus-transport", "event-emails", "free-registration"]);
    const list = await DataListModel.findOne({ organizationId: orgId }).lean();
    expect(list?.rowCount).toBe(2);
    expect(await DataListRowModel.countDocuments({ listId: list?._id })).toBe(2);

    const group = await EventGroupModel.findOne({ organizationId: orgId, name: "MVM Hálózatok Ünnepe 2026" }).lean();
    const event = await EventModel.findOne({ groupId: group?._id }).lean();
    expect(event?.capacity).toBe(1300);
    expect(event?.eligibilityFormRules?.rules[0]?.value).toBe(String(list?._id));
    expect(event?.attendeeFieldSchema.find((f) => f.key === "busz")?.choicesSource).toBe("bus-transport:routes");
    expect(Object.keys((event?.modules ?? {}) as object).sort()).toEqual(["bus-transport", "event-emails", "free-registration"]);

    const emails = await eventEmails.listEventEmails(String(event?._id));
    expect(emails).toHaveLength(6);
    expect(emails.filter((e) => e.trigger === "on_registration")).toHaveLength(2);
    expect(emails.find((e) => e.audience === "list_unregistered")?.listId?.toString()).toBe(String(list?._id));

    const attendee = (id: string) => ({
      fields: { nev: "Szőke Tibor", torzsszam: id, munkaltato: "DHEL", email: "szoke@example.com", telefon: "+36301112233", transzfer: "nem", vacsora: "igen", adatkezeles: "true" },
    });
    const customer = { name: "Szőke Tibor", email: "szoke@example.com", phone: "+36301112233", note: "" };
    const ok = await createBookingWithCheckout({ eventId: String(event?._id), guests: 1, customer, attendees: [attendee("60000001")] }, { groupId: String(group?._id) });
    expect(ok.status).toBe("confirmed");
    await expect(
      createBookingWithCheckout({ eventId: String(event?._id), guests: 1, customer, attendees: [attendee("99999999")] }, { groupId: String(group?._id) }),
    ).rejects.toThrow(/eligibility/);
  });

  it("won't create the same event twice", async () => {
    await expect(runSetupCommand("apply", ["--org", orgSlug, "--plan", planFile, "--uri", uri, "--apply", "--prod-ack", "--confirm", "SETUP"])).rejects.toThrow(/already exists/);
  });
});
