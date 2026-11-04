import crypto from "node:crypto";
import type { LoginRequestPurpose } from "@tbook/schemas";
import { LoginRequestModel, type ILoginRequest } from "../models/login-request";

const QR_TTL_MS = 5 * 60 * 1000;
const EMAIL_SWITCH_TTL_MS = 15 * 60 * 1000;

export const loginRequestRepository = {
  create(data: { purpose: LoginRequestPurpose; requesterLabel: string; callbackUrl: string }): Promise<ILoginRequest> {
    const token = crypto.randomBytes(32).toString("base64url");
    const ttlMs = data.purpose === "qr" ? QR_TTL_MS : EMAIL_SWITCH_TTL_MS;
    return LoginRequestModel.create({
      token,
      purpose: data.purpose,
      status: "pending",
      requesterLabel: data.requesterLabel,
      callbackUrl: data.callbackUrl,
      expiresAt: new Date(Date.now() + ttlMs),
    });
  },
  findByToken(token: string): Promise<ILoginRequest | null> {
    return LoginRequestModel.findOne({ token }).exec();
  },
  /** Only succeeds on a still-pending, unexpired request — the atomic guard against a double-confirm race. */
  confirm(
    token: string,
    user: { id: string; email: string; name?: string | null; image?: string | null },
  ): Promise<ILoginRequest | null> {
    return LoginRequestModel.findOneAndUpdate(
      { token, status: "pending", expiresAt: { $gt: new Date() } },
      {
        status: "confirmed",
        confirmedUserId: user.id,
        confirmedEmail: user.email,
        confirmedName: user.name ?? null,
        confirmedImage: user.image ?? null,
      },
      { returnDocument: "after" },
    ).exec();
  },
  /** Only succeeds once per confirmation — the atomic guard against replaying a claimed login. */
  markCompleted(token: string): Promise<ILoginRequest | null> {
    return LoginRequestModel.findOneAndUpdate({ token, status: "confirmed" }, { status: "completed" }, { returnDocument: "after" }).exec();
  },
  deny(token: string): Promise<ILoginRequest | null> {
    return LoginRequestModel.findOneAndUpdate({ token, status: "pending" }, { status: "denied" }, { returnDocument: "after" }).exec();
  },
};
