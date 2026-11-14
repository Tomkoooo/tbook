import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts", "packages/**/*.test.tsx", "apps/**/*.test.ts", "apps/**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/*.integration.test.ts", "**/*.live.test.ts"],
  },
});
