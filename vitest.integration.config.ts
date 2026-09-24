import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // apps/web route tests import route modules that use the `@/*` alias
      // (apps/web/tsconfig.json) — Next's own bundler resolves that via
      // tsconfig paths, but Vitest (run from the repo root) needs it here
      // too, since these integration tests import real route.ts files.
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.integration.test.ts", "apps/**/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      // Pin so mongodb-memory-server reuses a cached binary instead of
      // probing for "latest" on every run (flaky/slow in CI and locally).
      MONGOMS_VERSION: "7.0.24",
    },
  },
});
