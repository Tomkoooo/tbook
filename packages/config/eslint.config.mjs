// @ts-check
import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";

/**
 * Shared flat ESLint config re-used (not copy-pasted) by every workspace.
 * The root eslint.config.mjs just imports and extends this.
 */
export const baseConfig = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `varsIgnorePattern` matters for the `const { secret, ...rest } = x`
      // idiom used to drop a field from an API response — the omitted
      // binding is intentionally unused.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    settings: { next: { rootDir: "apps/web" } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
  {
    // Plain-JS Node scripts (migrations). They run under `node` directly,
    // not through the TS build, so the Node globals have to be declared
    // here — tseslint turns no-undef off for .ts files, but these are .mjs.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", URL: "readonly" },
    },
  },
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "**/*.config.*",
      "**/next-env.d.ts",
    ],
  },
);

export default baseConfig;
