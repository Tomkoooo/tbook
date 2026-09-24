import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbConnect, dbDisconnectAll } from "./connection";

/**
 * Proves the mongodb-memory-server based integration-test pattern that
 * Phase 2's legacy-fixture compatibility suite will rely on.
 */
describe("dbConnect", () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
  });

  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });

  it("connects and reports a ready readyState", async () => {
    const mongoose = await dbConnect(mongod.getUri());
    expect(mongoose.connection.readyState).toBe(1);
  });
});
