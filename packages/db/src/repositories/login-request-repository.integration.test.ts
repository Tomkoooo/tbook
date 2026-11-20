import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbConnect, dbDisconnectAll } from "../connection";
import { LoginRequestModel } from "../models/login-request";
import { loginRequestRepository } from "./login-request-repository";

describe("loginRequestRepository — device link (a signed-in device shows a QR)", () => {
  let mongod: MongoMemoryServer;
  const user = { id: "6af44de468da08303fcf0618", email: "pultos@example.com", name: "Pultos" };

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
  });
  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });

  it("is created confirmed as the signed-in user and can be claimed exactly once", async () => {
    const link = await loginRequestRepository.createDeviceLink(user, "Chrome on Mac");
    expect(link).toMatchObject({ purpose: "device-link", status: "confirmed", confirmedEmail: user.email });
    expect(link.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(2 * 60 * 1000);

    const first = await loginRequestRepository.claimDeviceLink(link.token);
    expect(first?.confirmedEmail).toBe(user.email);
    expect(await loginRequestRepository.claimDeviceLink(link.token)).toBeNull();
  });

  it("can't be claimed after it expires", async () => {
    const link = await loginRequestRepository.createDeviceLink(user, "x");
    await LoginRequestModel.updateOne({ token: link.token }, { expiresAt: new Date(Date.now() - 1000) });
    expect(await loginRequestRepository.claimDeviceLink(link.token)).toBeNull();
  });

  it("only claims device links, never QR or email-switch requests", async () => {
    const qr = await loginRequestRepository.create({ purpose: "qr", requesterLabel: "x", callbackUrl: "/admin" });
    await loginRequestRepository.confirm(qr.token, user);
    expect(await loginRequestRepository.claimDeviceLink(qr.token)).toBeNull();
  });
});
