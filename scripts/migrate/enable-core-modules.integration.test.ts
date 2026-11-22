import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error — plain-JS migration script, deliberately not part of the TS build (see its header).
import { CORE_MODULE_KEYS, applyCoreModuleGrants, computeCoreModuleGrants } from "./enable-core-modules.mjs";

/**
 * Existing organizations must keep Point of sale, Hotels and Ticket selling
 * when those become feature modules; this guards that, and that a re-run
 * never undoes a system admin's later decision.
 */
describe("enable-core-modules", () => {
  let mongod: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  const orgs = () => db.collection("tbookorganizations");

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri());
    await client.connect();
    db = client.db("tbook-admin-test");
  });

  afterAll(async () => {
    await client?.close();
    await mongod?.stop();
  });

  beforeEach(async () => {
    await orgs().deleteMany({});
  });

  async function seedOrg(fields: Record<string, unknown> = {}) {
    const _id = new ObjectId();
    await orgs().insertOne({ _id, name: "Org", slug: `org-${String(_id)}`, ...fields });
    return _id;
  }

  const getModules = async (id: ObjectId) => ((await orgs().findOne({ _id: id }))?.modules ?? {}) as Record<string, { enabled: boolean; config: object }>;

  it("grants all three modules to an organization with no modules at all", async () => {
    const id = await seedOrg();
    const { examined, grants } = await computeCoreModuleGrants(db);
    expect(examined).toBe(1);
    expect(grants[0].missing).toEqual(CORE_MODULE_KEYS);

    await applyCoreModuleGrants(db, grants);
    const modules = await getModules(id);
    for (const key of ["point-of-sale", "hotels", "ticket-sales"]) {
      expect(modules[key]).toMatchObject({ enabled: true, config: {}, changedBy: null });
    }
  });

  it("keeps modules the organization already has and adds only the missing ones", async () => {
    const id = await seedOrg({ modules: { "bus-transport": { enabled: true, config: { transferRules: "x" } }, hotels: { enabled: true, config: { a: "b" } } } });
    const { grants } = await computeCoreModuleGrants(db);
    expect(grants[0].missing).toEqual(["point-of-sale", "ticket-sales"]);

    await applyCoreModuleGrants(db, grants);
    const modules = await getModules(id);
    expect(modules["bus-transport"]).toEqual({ enabled: true, config: { transferRules: "x" } });
    expect(modules.hotels).toEqual({ enabled: true, config: { a: "b" } });
    expect(modules["point-of-sale"].enabled).toBe(true);
    expect(modules["ticket-sales"].enabled).toBe(true);
  });

  it("never re-enables a module a system admin withdrew", async () => {
    const id = await seedOrg({ modules: { hotels: { enabled: false, config: {} } } });
    const { grants } = await computeCoreModuleGrants(db);
    await applyCoreModuleGrants(db, grants);
    expect((await getModules(id)).hotels.enabled).toBe(false);
  });

  it("is idempotent — a second run finds nothing to change", async () => {
    await seedOrg();
    await seedOrg({ modules: { "ticket-sales": { enabled: true } } });
    const first = await computeCoreModuleGrants(db);
    expect(first.grants).toHaveLength(2);
    await applyCoreModuleGrants(db, first.grants);

    const second = await computeCoreModuleGrants(db);
    expect(second.examined).toBe(2);
    expect(second.grants).toHaveLength(0);
    expect(await applyCoreModuleGrants(db, second.grants)).toBe(0);
  });

  it("handles a legacy organization whose modules field is null", async () => {
    const id = await seedOrg({ modules: null });
    const { grants } = await computeCoreModuleGrants(db);
    await applyCoreModuleGrants(db, grants);
    expect((await getModules(id))["point-of-sale"].enabled).toBe(true);
  });

  it("does not write over an entry that appeared between the read and the write", async () => {
    const id = await seedOrg();
    const { grants } = await computeCoreModuleGrants(db);
    // A system admin switches Hotels off after the read, before the write.
    await orgs().updateOne({ _id: id }, { $set: { "modules.hotels": { enabled: false, config: {} } } });
    await applyCoreModuleGrants(db, grants);
    const modules = await getModules(id);
    expect(modules.hotels.enabled).toBe(false);
    expect(modules["point-of-sale"].enabled).toBe(true);
  });

  it("does nothing on an empty database", async () => {
    const { examined, grants } = await computeCoreModuleGrants(db);
    expect(examined).toBe(0);
    expect(grants).toHaveLength(0);
  });
});
