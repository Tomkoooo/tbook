"use server";

import { headers } from "next/headers";
import { ensureDbConnection, loginRequestRepository } from "@tbook/db";
import { generateLoginQrDataUrl } from "@tbook/services";
import { auth } from "@/auth";
import { issueSessionCookie } from "@/lib/session-cookie";
import { describeDevice } from "./device-label";

export async function createQrLoginRequestAction(callbackUrl: string): Promise<{ token: string; qrDataUrl: string }> {
  await ensureDbConnection();
  const userAgent = (await headers()).get("user-agent");
  const request = await loginRequestRepository.create({
    purpose: "qr",
    requesterLabel: describeDevice(userAgent),
    callbackUrl,
  });
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || "";
  const confirmUrl = new URL(`/auth/qr/confirm?token=${request.token}`, appUrl).toString();
  const qrDataUrl = await generateLoginQrDataUrl(confirmUrl);
  return { token: request.token, qrDataUrl };
}

export type LoginRequestPollResult =
  | { status: "pending" }
  | { status: "ready"; redirectTo: string }
  | { status: "denied" }
  | { status: "expired" };

/** Polled every ~2.5s by the waiting device (same pattern as admin/sales-actions.ts's pollCardSaleAction). */
export async function pollLoginRequestAction(token: string): Promise<LoginRequestPollResult> {
  await ensureDbConnection();
  const request = await loginRequestRepository.findByToken(token);
  if (!request || request.status === "completed" || request.expiresAt.getTime() < Date.now()) {
    return { status: "expired" };
  }
  if (request.status === "denied") return { status: "denied" };
  if (request.status === "pending") return { status: "pending" };

  // status === "confirmed": atomically claim it — only one poller can ever win this.
  const claimed = await loginRequestRepository.markCompleted(token);
  if (!claimed?.confirmedUserId || !claimed.confirmedEmail) return { status: "expired" };

  await issueSessionCookie({
    id: String(claimed.confirmedUserId),
    email: claimed.confirmedEmail,
    name: claimed.confirmedName,
    image: claimed.confirmedImage,
  });
  return { status: "ready", redirectTo: claimed.callbackUrl };
}

/** Called from the *approving* device, which must already have a real session. */
export async function confirmLoginRequestAction(token: string): Promise<{ ok: boolean; message?: string }> {
  await ensureDbConnection();
  const session = await auth();
  if (!session?.user?.id || !session.user.email) return { ok: false, message: "Sign in first." };

  const confirmed = await loginRequestRepository.confirm(token, {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image,
  });
  return confirmed ? { ok: true } : { ok: false, message: "This sign-in request is no longer valid." };
}

export async function denyLoginRequestAction(token: string): Promise<void> {
  await ensureDbConnection();
  await loginRequestRepository.deny(token);
}
