import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe NextAuth config — no @tbook/services or @tbook/db imports here
 * (those pull in mongoose/nodemailer, which aren't edge-runtime-safe). The
 * actual email provider (which needs @tbook/services' mailer) and the DB
 * adapter are added in auth.ts, which runs Node-only. This split matters
 * once/if a middleware.ts is added later (middleware runs on the Edge
 * runtime by default) — no middleware exists yet, but keeping the split now
 * avoids a rewrite later.
 */
export const authConfig = {
  providers: [],
  callbacks: {
    async redirect({ url, baseUrl }) {
      const preferred = process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL;
      if (preferred) {
        try {
          const target = new URL(url, preferred);
          const preferredOrigin = new URL(preferred).origin;
          if (target.origin === preferredOrigin || target.origin === baseUrl) {
            return target.toString();
          }
        } catch {
          // fall through to default baseUrl-relative handling below
        }
      }
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      try {
        if (new URL(url).origin === baseUrl) return url;
      } catch {
        // ignore
      }
      return baseUrl;
    },
  },
} satisfies NextAuthConfig;
