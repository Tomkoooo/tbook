import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship raw TypeScript (no build step) — Next needs to
  // run its own loader over them rather than treating them as pre-built.
  transpilePackages: ["@tbook/schemas", "@tbook/db", "@tbook/domain", "@tbook/services", "@tbook/actions"],
  // Overridable so a verification build can run next to a live `next dev`
  // without overwriting its .next folder (default unchanged).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Standalone output is what the Dockerfile copies into the runner stage.
  output: "standalone",
  // Lint runs as its own CI/pre-push step (npm run lint, real flat-config
  // aware); next build's built-in ESLint step doesn't detect flat config
  // and would otherwise just print a misleading warning here.
  eslint: { ignoreDuringBuilds: true },
  // The workspace root sits two levels up from this app.
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
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
