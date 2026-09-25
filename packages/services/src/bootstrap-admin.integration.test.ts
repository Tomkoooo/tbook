import { MongoMemoryServer } from "mongodb-memory-server";
import { UserModel, dbConnect, dbDisconnectAll, userRepository } from "@tbook/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BOOTSTRAP_ADMIN_ENV, BOOTSTRAP_SYSTEM_ADMIN_ENV, maybeBootstrapAdmin } from "./bootstrap-admin";

describe("maybeBootstrapAdmin", () => {
  let mongod: MongoMemoryServer;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
  });

  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });

  beforeEach(async () => {
    await UserModel.deleteMany({});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("promotes an allowlisted, existing user to isSystemAdmin", async () => {
    process.env[BOOTSTRAP_ADMIN_ENV] = "admin@example.com";
    await UserModel.create({ email: "admin@example.com", isSystemAdmin: false });

    await maybeBootstrapAdmin("admin@example.com");

    expect((await userRepository.findByEmail("admin@example.com"))?.isSystemAdmin).toBe(true);
  });

  it("does nothing when the allowlist is empty", async () => {
    delete process.env[BOOTSTRAP_ADMIN_ENV];
    delete process.env[BOOTSTRAP_SYSTEM_ADMIN_ENV];
    await UserModel.create({ email: "someone@example.com", isSystemAdmin: false });

    await maybeBootstrapAdmin("someone@example.com");

    expect((await userRepository.findByEmail("someone@example.com"))?.isSystemAdmin).toBe(false);
  });

  it("does nothing for an email not on the allowlist", async () => {
    process.env[BOOTSTRAP_ADMIN_ENV] = "admin@example.com";
    await UserModel.create({ email: "someone-else@example.com", isSystemAdmin: false });

    await maybeBootstrapAdmin("someone-else@example.com");

    expect((await userRepository.findByEmail("someone-else@example.com"))?.isSystemAdmin).toBe(false);
  });

  it("BOOTSTRAP_SYSTEM_ADMIN_EMAILS takes precedence over BOOTSTRAP_ADMIN_EMAILS", async () => {
    process.env[BOOTSTRAP_SYSTEM_ADMIN_ENV] = "system@example.com";
    process.env[BOOTSTRAP_ADMIN_ENV] = "legacy@example.com";
    await UserModel.create({ email: "legacy@example.com", isSystemAdmin: false });

    await maybeBootstrapAdmin("legacy@example.com");

    expect((await userRepository.findByEmail("legacy@example.com"))?.isSystemAdmin).toBe(false);
  });

  it("is a no-op if the user doesn't exist yet (adapter hasn't created the row)", async () => {
    process.env[BOOTSTRAP_ADMIN_ENV] = "ghost@example.com";
    await expect(maybeBootstrapAdmin("ghost@example.com")).resolves.toBeUndefined();
  });
});
