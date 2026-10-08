import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { dbDisconnectAll, ensureDbConnection } from "./connection";
import { UserModel } from "./models/user";

/**
 * Guards the request-layer connection guard. The bug it exists to prevent:
 * importing a Mongoose model opens nothing, so a query issued before any
 * connect() buffers and then fails with "buffering timed out" — which
 * looks like an outage. Before ensureDbConnection, /api/health was the only
 * caller of dbConnect, so a freshly started container failed every public
 * API request until the healthcheck happened to connect as a side effect.
 */
describe("ensureDbConnection", () => {
  let mongod: MongoMemoryServer;
  const originalUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
  });

  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
    process.env.DATABASE_URL = originalUrl;
  });

  afterEach(async () => {
    await dbDisconnectAll();
    process.env.DATABASE_URL = originalUrl;
  });

  it("connects from DATABASE_URL so a model query works without any explicit dbConnect", async () => {
    process.env.DATABASE_URL = mongod.getUri();

    await ensureDbConnection();
    // The real assertion: a query runs instead of buffering out.
    await expect(UserModel.countDocuments({}).exec()).resolves.toBeTypeOf("number");
    expect(mongoose.connection.readyState).toBe(1);
  });

  it("is idempotent — repeated calls reuse one connection", async () => {
    process.env.DATABASE_URL = mongod.getUri();

    const [a, b, c] = await Promise.all([ensureDbConnection(), ensureDbConnection(), ensureDbConnection()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("gives a clear error rather than a buffering timeout when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    await expect(ensureDbConnection()).rejects.toThrow("DATABASE_URL is not set");
  });
});
