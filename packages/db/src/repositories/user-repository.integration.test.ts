import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dbConnect, dbDisconnectAll } from "../connection";
import { UserModel } from "../models/user";
import { userRepository } from "./user-repository";

/**
 * Proves the account-continuity requirement: a `users` document created by
 * any prior sign-in mechanism (magic-link, or the raw driver directly — as
 * @auth/mongodb-adapter itself would write on first sign-in) is found by
 * email and its tbook-specific fields (isSystemAdmin) survive
 * ensureUserProfile's upsert. Collection name/shape must match what
 * @auth/mongodb-adapter reads/writes ("users", email-keyed) — verified here
 * at the Mongoose-model level since a real OAuth/email handshake can't be
 * exercised in this environment.
 */
describe("userRepository — account continuity", () => {
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
    await UserModel.deleteMany({});
  });

  it("finds an existing user by email (case-insensitive)", async () => {
    await UserModel.create({ email: "admin@example.com", name: "Admin", isSystemAdmin: true });
    const found = await userRepository.findByEmail("Admin@Example.com");
    expect(found?.email).toBe("admin@example.com");
    expect(found?.isSystemAdmin).toBe(true);
  });

  it("ensureUserProfile does not clobber isSystemAdmin on an existing user", async () => {
    const existing = await UserModel.create({ email: "owner@example.com", name: "Old Name", isSystemAdmin: true });

    const id = await userRepository.ensureUserProfile({ id: String(existing._id), email: "owner@example.com", name: "New Name", image: null });
    expect(id).toBe(String(existing._id));

    const reloaded = await userRepository.findByEmail("owner@example.com");
    expect(reloaded?.isSystemAdmin).toBe(true); // untouched
    expect(reloaded?.name).toBe("New Name"); // profile fields still sync
  });

  it("ensureUserProfile creates a new user with USER role by default", async () => {
    const id = await userRepository.ensureUserProfile({ email: "new@example.com", name: "New Person", image: null });
    expect(id).toBeTruthy();
    const created = await userRepository.findByEmail("new@example.com");
    expect(created?.role).toBe("USER");
    expect(created?.isSystemAdmin).toBe(false);
  });

  it("matches by id first, falling back to email, without creating a duplicate", async () => {
    const existing = await UserModel.create({ email: "dup@example.com", isSystemAdmin: false });
    await userRepository.ensureUserProfile({ id: "000000000000000000000000", email: "dup@example.com", name: "X", image: null });
    const count = await UserModel.countDocuments({ email: "dup@example.com" });
    expect(count).toBe(1);
    expect(String((await userRepository.findByEmail("dup@example.com"))?._id)).toBe(String(existing._id));
  });

  it("setSystemAdmin flips the flag without touching other fields", async () => {
    const user = await UserModel.create({ email: "future-admin@example.com", name: "Future Admin", isSystemAdmin: false });
    await userRepository.setSystemAdmin(String(user._id), true);
    const reloaded = await userRepository.findByEmail("future-admin@example.com");
    expect(reloaded?.isSystemAdmin).toBe(true);
    expect(reloaded?.name).toBe("Future Admin");
  });
});
