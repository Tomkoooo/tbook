import type { NextConfig } from "next";

/** An event id in a query string, captured as `:eventId` in the redirect destination. */
const EVENT_ID_QUERY = [{ type: "query" as const, key: "eventId", value: "(?<eventId>[0-9a-f]{24})" }];
const GROUP_ID_QUERY = [{ type: "query" as const, key: "groupId", value: "(?<groupId>[0-9a-f]{24})" }];

/** Tools that moved under /admin/events/[eventId]/ (they used to take ?eventId=). */
const MOVED_EVENT_TOOLS = "bookings|check-in|sales|stand|bus|waitlist|feedback|kiosk|emails|vip|reports|preview";
/** Moved tools that are only an event's list page when there is no event: send those to the events list. */
const EVENT_ONLY_LISTS = "bus|waitlist|feedback|kiosk|emails|vip|preview";

/**
 * Every pre-restructure console URL keeps working (see docs/console-structure.md,
 * "Old URLs"). Not permanent yet: switch to `permanent: true` once nothing
 * links to the old paths. First match wins, so the specific rules come first.
 *
 * Not redirected on purpose: the station pickers /admin/check-in, /admin/sales
 * and /admin/stand without ?eventId= ("which event?"), and old detail URLs that
 * carry only a record id (/admin/bus/[routeId], /admin/feedback/[surveyId],
 * /admin/kiosk/[surveyId], /admin/emails/[emailId], /admin/hotels/[hotelId]
 * without ?eventId= / ?groupId=): a static rule can't know their event.
 */
const legacyRedirects = [
  // Merch register left /admin/sales.
  { source: "/admin/sales/merch/:path*", destination: "/admin/merch/:path*", permanent: false },
  // Door check-in used a path segment for the event.
  { source: "/admin/check-in/:eventId([0-9a-f]{24})/:path*", destination: "/admin/events/:eventId/check-in/:path*", permanent: false },
  // Hotels belong to a group now.
  { source: "/admin/hotels", has: GROUP_ID_QUERY, destination: "/admin/groups/:groupId/hotels", permanent: false },
  { source: "/admin/hotels/:hotelId", has: GROUP_ID_QUERY, destination: "/admin/groups/:groupId/hotels/:hotelId", permanent: false },
  { source: "/admin/hotels", destination: "/admin/groups", permanent: false },
  // ?eventId= tools (and their sub-pages: new, export, products, safe, stats, …).
  { source: `/admin/:tool(${MOVED_EVENT_TOOLS})`, has: EVENT_ID_QUERY, destination: "/admin/events/:eventId/:tool", permanent: false },
  { source: `/admin/:tool(${MOVED_EVENT_TOOLS})/:path+`, has: EVENT_ID_QUERY, destination: "/admin/events/:eventId/:tool/:path+", permanent: false },
  // An event's list page without an event: pick one.
  { source: `/admin/:tool(${EVENT_ONLY_LISTS})`, destination: "/admin/events", permanent: false },
  { source: "/admin/bookings/new", destination: "/admin/events", permanent: false },
];

const nextConfig: NextConfig = {
  // Workspace packages ship raw TypeScript (no build step) — Next needs to
  // run its own loader over them rather than treating them as pre-built.
  transpilePackages: ["@tbook/schemas", "@tbook/db", "@tbook/domain", "@tbook/services", "@tbook/actions", "@tbook/modules"],
  // Overridable so a verification build can run next to a live `next dev`
  // without overwriting its .next folder (default unchanged).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Standalone output is what the Dockerfile copies into the runner stage.
  output: "standalone",
  // Lint runs as its own CI/pre-push step (npm run lint, real flat-config
  // aware); next build's built-in ESLint step doesn't detect flat config
  // and would otherwise just print a misleading warning here.
  eslint: { ignoreDuringBuilds: true },
  // Spreadsheet imports (Data → Import) upload through a server action;
  // the 1 MB default is too small for a staff list.
  experimental: { serverActions: { bodySizeLimit: "15mb" } },
  // The workspace root sits two levels up from this app.
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  async headers() {
    return [
      // The worker must always be revalidated, or a broken one can't be replaced.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Service-Worker-Allowed", value: "/" }] },
    ];
  },
  async redirects() {
    return legacyRedirects;
  },
  async rewrites() {
    return [
      // Legacy path alias so the still-running Sörfeszt / World Darts
      // Festival storefronts (TBOOK_UPSTREAM_API_BASE pointed at
      // https://tbook.sironic.hu/api/plugins/t-book) keep working unchanged.
      {
        source: "/api/plugins/t-book/:path*",
        destination: "/api/v1/:path*",
      },
    ];
  },
};

export default nextConfig;
