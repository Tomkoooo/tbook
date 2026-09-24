import { defineConfig } from "vitest/config";

export default defineConfig({
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
