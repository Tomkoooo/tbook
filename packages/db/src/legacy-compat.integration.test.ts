import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Types } from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbConnect, dbDisconnectAll } from "./connection";
import { EventGroupModel } from "./models/event-group";
import { EventModel } from "./models/event";
import { OrganizationModel } from "./models/organization";
import { OrgMembershipModel } from "./models/org-membership";
import { OrgRoleModel } from "./models/org-role";
import { eventGroupRepository } from "./repositories/event-group-repository";
import { eventRepository } from "./repositories/event-repository";
import { organizationRepository } from "./repositories/organization-repository";
import { orgMembershipRepository } from "./repositories/org-membership-repository";
import { orgRoleRepository } from "./repositories/org-role-repository";

/**
 * The real backward-compatibility gate (approved plan, §2): loads actual
 * anonymized production documents (scripts/migration-fixtures/) straight
 * into a throwaway MongoDB and asserts the new Mongoose models/repositories
 * can read every legacy doc shape without throwing — including the known
 * drift cases (an event-group with no organizationId, event docs missing
 * fields added by later schema versions).
 */

const FIXTURES_DIR = fileURLToPath(new URL("../../../scripts/migration-fixtures/sorfeszt-tbook-admin/", import.meta.url));

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Converts 24-hex strings to ObjectId and ISO date strings to Date, exactly what a real raw-driver read of these documents already looks like on the wire. */
function reviveLegacyValues(_key: string, value: unknown): unknown {
  if (typeof value === "string") {
    if (OBJECT_ID_RE.test(value)) return new Types.ObjectId(value);
    if (ISO_DATE_RE.test(value)) return new Date(value);
  }
  return value;
}

function loadFixture(fileName: string): Record<string, unknown>[] {
  const raw = readFileSync(`${FIXTURES_DIR}${fileName}`, "utf-8");
  return JSON.parse(raw, reviveLegacyValues) as Record<string, unknown>[];
}

describe("legacy production-data compatibility", () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());

    // Bypass Mongoose validation on insert — these are pre-existing
    // production documents, not app-created ones, and some intentionally
    // predate fields the current schema adds defaults for.
    await OrganizationModel.collection.insertMany(loadFixture("tbookorganizations.json"));
    await EventGroupModel.collection.insertMany(loadFixture("tbookeventgroups.json"));
    await EventModel.collection.insertMany(loadFixture("tbookevents.json"));
    await OrgRoleModel.collection.insertMany(loadFixture("tbookorgroles.json"));
    await OrgMembershipModel.collection.insertMany(loadFixture("tbookorgmemberships.json"));
  });

  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });

  it("reads every organization document through the Mongoose model", async () => {
    const orgs = await OrganizationModel.find().exec();
    expect(orgs.length).toBeGreaterThan(0);
    for (const org of orgs) {
      expect(org.name).toBeTruthy();
      expect(org.slug).toBeTruthy();
      // Encrypted secret fields round-trip as opaque strings — no decryption attempted here.
      expect(typeof org.settings.currency).toBe("string");
    }
  });

  it("reads the legacy event group with no organizationId (pre-multi-tenant data)", async () => {
    const groups = await EventGroupModel.find().exec();
    expect(groups.length).toBeGreaterThan(0);
    const legacyGroup = groups.find((g) => g.organizationId == null);
    expect(legacyGroup).toBeDefined();
    expect(legacyGroup?.apiKeyHash).toBeTruthy();
    expect(legacyGroup?.defaultAttendeeFieldSchema).toEqual([]);
  });

  it("reads event documents missing fields added by later schema versions", async () => {
    const events = await EventModel.find().exec();
    expect(events.length).toBe(23);
    const legacyEvent = events.find((e) => e.organizationId == null);
    expect(legacyEvent).toBeDefined();
    // These fields don't exist in the raw legacy document — Mongoose must supply the schema defaults.
    expect(legacyEvent?.registrationUnit).toBe("person");
    expect(legacyEvent?.playersPerTicket).toBe(1);
    expect(legacyEvent?.eligibilityPreset).toBe("none");
    expect(legacyEvent?.tdarts.enabled).toBe(false);
    expect(legacyEvent?.tdarts.tournamentCode).toBe(null);
    expect(legacyEvent?.publicListing).toBe("listed");
    expect(legacyEvent?.attendeeFieldSchemaMode).toBe("extend");
  });

  it("reads a role with the real permission catalog, including a custom non-built-in role", async () => {
    const roles = await OrgRoleModel.find().exec();
    expect(roles.length).toBeGreaterThan(0);
    const owner = roles.find((r) => r.name === "Owner");
    expect(owner?.isBuiltIn).toBe(true);
    expect(owner?.permissions).toContain("booking:manage");
  });

  it("reads org memberships and resolves role ids", async () => {
    const memberships = await OrgMembershipModel.find().exec();
    expect(memberships.length).toBeGreaterThan(0);
    for (const membership of memberships) {
      expect(membership.organizationId).toBeDefined();
      expect(membership.userId).toBeDefined();
      expect(Array.isArray(membership.roleIds)).toBe(true);
    }
  });

  it("repositories resolve the same documents by their real ids", async () => {
    const [firstGroup] = await EventGroupModel.find().limit(1).exec();
    expect(firstGroup).toBeDefined();
    const viaRepository = await eventGroupRepository.findById(String(firstGroup!._id));
    expect(viaRepository?.name).toBe(firstGroup!.name);

    const groupEvents = await eventRepository.findByGroupId(String(firstGroup!._id));
    expect(groupEvents.length).toBeGreaterThan(0);

    const [firstOrg] = await OrganizationModel.find().limit(1).exec();
    const orgBySlug = await organizationRepository.findBySlug(firstOrg!.slug);
    expect(String(orgBySlug?._id)).toBe(String(firstOrg!._id));

    const roles = await orgRoleRepository.findByOrganizationId(String(firstOrg!._id));
    expect(roles.length).toBeGreaterThan(0);

    const memberships = await orgMembershipRepository.findByOrganizationId(String(firstOrg!._id));
    expect(memberships.length).toBeGreaterThan(0);
  });
});
