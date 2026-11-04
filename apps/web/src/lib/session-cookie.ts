import { cookies } from "next/headers";
import { encode } from "next-auth/jwt";

/**
 * Mints a NextAuth-compatible JWT session cookie by hand, for the one case
 * NextAuth itself has no API for: putting a session on a *different*
 * browser than the one that proved its identity (QR sign-in confirmed by
 * an already-logged-in phone; a magic link finished on the device that
 * originally requested it). `encode`/the cookie name+attributes below
 * mirror @auth/core's own session() handling exactly (see auth.ts's
 * session callback, which re-derives role/org data from `sub`/`email`
 * alone) and @auth/core/src/lib/utils/cookie.ts's `defaultCookies()` —
 * anything issued here is indistinguishable from a session NextAuth itself
 * created via the normal sign-in flow.
 */
export async function issueSessionCookie(user: { id: string; email: string; name?: string | null; image?: string | null }): Promise<void> {
  const appUrl = process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  const secure = appUrl.startsWith("https://");
  const cookieName = `${secure ? "__Secure-" : ""}authjs.session-token`;

  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");

  const value = await encode({
    token: { sub: user.id, email: user.email, name: user.name ?? null, picture: user.image ?? null },
    secret,
    salt: cookieName,
  });

  (await cookies()).set({
    name: cookieName,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
}
