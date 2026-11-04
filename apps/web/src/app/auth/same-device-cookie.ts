/**
 * Set on the browser that requests a magic link, holding that request's
 * LoginRequest token. switch-device/page.tsx compares it against the
 * token the clicked link carries: a match means the link was opened on
 * the same browser that requested it (skip the cross-device chooser), a
 * mismatch (or no cookie at all) means it was opened somewhere else.
 */
export const SAME_DEVICE_COOKIE = "tbook_lr";

export function sameDeviceCookieOptions(token: string) {
  return {
    name: SAME_DEVICE_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/auth",
    maxAge: 15 * 60,
  };
}
