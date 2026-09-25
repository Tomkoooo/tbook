import { MongoDBAdapter } from "@auth/mongodb-adapter";
import NextAuth from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import { getMongoClient, userRepository } from "@tbook/db";
import { listOrganizationsForUser, maybeBootstrapAdmin, sendMail } from "@tbook/services";
import { authConfig } from "./auth.config";
import { getActiveOrganizationIdFromCookie } from "./lib/org-cookie";

function magicLinkEmailHtml(url: string): string {
  return `
    <p>Click the link below to sign in to tBook. This link expires shortly and can only be used once.</p>
    <p><a href="${url}">Sign in to tBook</a></p>
    <p>If you didn't request this, you can safely ignore this email.</p>
  `;
}

declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: "ADMIN" | "USER";
      isSystemAdmin: boolean;
      organizationIds: string[];
      activeOrganizationId?: string;
    };
  }
}

const trustHost = process.env.AUTH_TRUST_HOST ? process.env.AUTH_TRUST_HOST === "true" : process.env.NODE_ENV !== "production";

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

/**
 * Email magic-link sign-in (no OAuth). MongoDBAdapter + the same
 * DATABASE_URL as everywhere else in this app is what makes existing
 * accounts work here: a `users` document matched by email (e.g. one already
 * flagged `isSystemAdmin: true`) is found immediately on first magic-link
 * sign-in — email sign-in has no separate "account linking" step the way
 * OAuth does, since there's no third-party identity to link, just the email
 * address itself.
 *
 * sendVerificationRequest routes through @tbook/services' mailer (platform
 * SMTP — same env vars as every other outbound email in this system, e.g.
 * voucher delivery) instead of NextAuth's own nodemailer transport, so
 * there's one mail-sending code path, not two.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  // Lazy factory, not an eagerly-resolved client: Next's build-time page-data
  // collection evaluates this module (same class of issue as
  // voucher-pdf.ts's font-path fix) and DATABASE_URL isn't set at build time
  // (the Dockerfile passes it as a runtime env var, not a build ARG) — a
  // function is only invoked when the adapter actually needs a connection,
  // i.e. at request time.
  adapter: MongoDBAdapter(() => getMongoClient(databaseUrl())),
  session: { strategy: "jwt" },
  trustHost,
  ...authConfig,
  providers: [
    Nodemailer({
      server: "smtp://unused:unused@localhost:1",
      from: process.env.EMAIL_FROM || "noreply@example.com",
      async sendVerificationRequest({ identifier: email, url }) {
        await sendMail(null, { to: email, subject: "Sign in to tBook", html: magicLinkEmailHtml(url) });
      },
    }),
  ],
  events: {
    async createUser({ user }) {
      try {
        await userRepository.ensureUserProfile({ id: user.id, email: user.email, name: user.name, image: user.image });
      } catch (error) {
        console.error("[auth] ensure user profile on createUser failed", error);
      }
    },
    async signIn({ user }) {
      const userId = user.id?.trim();
      const email = user.email?.trim();
      try {
        await userRepository.ensureUserProfile({ id: userId, email, name: user.name, image: user.image });
      } catch (error) {
        console.error("[auth] ensure user profile on signIn failed", error);
      }
      try {
        await maybeBootstrapAdmin(email);
      } catch (error) {
        console.error("[auth] bootstrap admin on signIn failed", error);
      }
    },
  },
  callbacks: {
    ...authConfig.callbacks,
    // No jwt callback needed: the session callback below always does a
    // fresh DB lookup for role/isSystemAdmin/org membership on every
    // request rather than trusting a value cached in the token, so there's
    // nothing useful to stash on the token itself.
    async session({ session, token }) {
      if (!session.user) return session;
      session.user.role = "USER";
      session.user.isSystemAdmin = false;
      session.user.organizationIds = [];

      if (token.sub) session.user.id = token.sub;
      const lookupEmail = (typeof token.email === "string" ? token.email : session.user.email)?.trim().toLowerCase();
      if (!lookupEmail) return session;

      try {
        const dbUser = await userRepository.findByEmail(lookupEmail);
        if (dbUser) {
          session.user.id = String(dbUser._id);
          session.user.role = dbUser.role ?? "USER";
          session.user.isSystemAdmin = dbUser.isSystemAdmin === true;
          session.user.organizationIds = await listOrganizationsForUser(String(dbUser._id)).then((orgs) => orgs.map((o) => o.id));
          const activeOrgId = await getActiveOrganizationIdFromCookie();
          if (activeOrgId) session.user.activeOrganizationId = activeOrgId;
        }
      } catch (error) {
        console.error("[auth] failed to enrich session from db", error);
      }
      return session;
    },
  },
});
