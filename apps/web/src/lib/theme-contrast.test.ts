import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the colour tokens in app/globals.css: every text/foreground pair that
 * the UI actually renders must keep WCAG AA (4.5:1) in light and dark mode.
 * Colours are written in oklch there, so they are converted to sRGB here.
 */
const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");

function block(selector: RegExp): string {
  const start = css.search(selector);
  if (start < 0) throw new Error(`block not found: ${selector}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("unbalanced braces");
}

function vars(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(oklch\([^)]*\))\s*;/g)) out[m[1]!] = m[2]!;
  return out;
}

const light = vars(block(/^:root\s*\{/m));
const dark = { ...light, ...vars(block(/^\s*\.dark\s*\{/m)) };

function luminance(oklch: string): number {
  const m = oklch.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!m) throw new Error(`not oklch: ${oklch}`);
  const L = Number(m[1]);
  const C = Number(m[2]);
  const h = (Number(m[3]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
}

function contrast(fg: string, bg: string): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const TONES = ["success", "warning", "danger", "info", "note", "neutral"] as const;

/** [foreground token, background token] pairs rendered as text. */
const PAIRS: Array<[string, string]> = [
  ["foreground", "background"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["accent-foreground", "accent"],
  ["sidebar-foreground", "sidebar"],
  ["sidebar-primary-foreground", "sidebar-primary"],
  ["sidebar-accent-foreground", "sidebar-accent"],
  ["destructive", "background"],
  ["destructive", "card"],
  ...TONES.flatMap((t): Array<[string, string]> => [
    [`${t}-foreground`, t],
    [`${t}-soft-foreground`, `${t}-soft`],
    [t, "background"],
    [t, "card"],
  ]),
];

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("%s tokens", (_mode, tokens) => {
  it.each(PAIRS)("%s on %s is at least 4.5:1", (fg, bg) => {
    expect(tokens[fg], `--${fg} missing`).toBeDefined();
    expect(tokens[bg], `--${bg} missing`).toBeDefined();
    expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("theme tokens", () => {
  it("keeps white button text on the orange primary at AA", () => {
    expect(contrast(light["primary-foreground"]!, light.primary!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("oklch(1 0 0)", light.destructive!)).toBeGreaterThanOrEqual(4.5);
  });

  it("has a single .dark block", () => {
    expect(css.match(/^\s*\.dark\s*\{/gm)).toHaveLength(1);
  });

  it("no longer uses the --tbook-* layer or data-theme", () => {
    expect(css).not.toMatch(/--tbook-/);
    expect(css).not.toMatch(/data-theme/);
  });
});
