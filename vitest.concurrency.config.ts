import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.concurrency.test.ts", "apps/**/*.concurrency.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Concurrency/race tests must run isolated, one at a time.
    fileParallelism: false,
  },
});
