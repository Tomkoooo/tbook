import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EJSON } from "bson";
import type { Flags } from "./args";
import { CliError } from "./errors";
import type { FieldChange } from "./interact";

/**
 * The write gate every mutating command calls before doing anything.
 * Default is always dry-run (`"dry-run"`): the caller prints its plan and
 * stops. A write additionally requires `--prod-ack`, because this CLI
 * treats whatever database it's connected to as production, unconditionally
 * — there is no name-sniffing to opt out of the check.
 */
export function checkApplyGate(flags: Flags): "dry-run" | "ok" {
  if (!flags.bool("apply")) return "dry-run";
  if (!flags.bool("prod-ack")) {
    throw new CliError(
      "Refusing to write: this CLI treats the connected database as PRODUCTION, always.\n" +
        "Re-run with --apply --prod-ack once you mean it.",
    );
  }
  return "ok";
}

export interface Operator {
  name: string;
  source: string;
}

/** --operator flag > TBOOK_CLI_OPERATOR env > git identity > OS user — always something attributable. */
export function resolveOperator(flags: Flags): Operator {
  const flagValue = flags.get("operator");
  if (flagValue) return { name: flagValue, source: "--operator" };

  const envValue = process.env.TBOOK_CLI_OPERATOR;
  if (envValue) return { name: envValue, source: "TBOOK_CLI_OPERATOR" };

  try {
    const email = execFileSync("git", ["config", "user.email"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const name = execFileSync("git", ["config", "user.name"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (email) return { name: name ? `${name} <${email}>` : email, source: "git config" };
  } catch {
    // No git identity configured — fall through to the OS user.
  }

  return { name: os.userInfo().username, source: "os user" };
}

export interface AuditEntry {
  timestamp: string;
  operator: Operator;
  command: string[];
  entity: string;
  action: string;
  organizationId: string;
  recordId: string | null;
  changes: FieldChange[];
  reversible: boolean;
  note?: string;
}

/**
 * Writes the restore point for one mutating command: the affected
 * document(s) exactly as they were before and after, plus the audit entry
 * (who, when, what). A scoped backup of only the documents this command
 * touched — never a full-DB dump. Lives under backups/ (gitignored: it
 * carries real customer data) alongside this repo's other incident
 * backups and the scripts/migrate journal/backup convention.
 */
export function writeRestorePoint(opts: {
  entity: string;
  action: string;
  recordId: string | null;
  before: unknown;
  after: unknown;
  audit: AuditEntry;
}): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.resolve("backups", "cli", `${opts.entity}-${opts.action}-${opts.recordId ?? "new"}-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "before.json"), EJSON.stringify(opts.before ?? null, { relaxed: false }, 2));
  fs.writeFileSync(path.join(dir, "after.json"), EJSON.stringify(opts.after ?? null, { relaxed: false }, 2));
  fs.writeFileSync(path.join(dir, "audit.json"), JSON.stringify(opts.audit, null, 2));
  fs.appendFileSync(path.resolve("backups", "cli", "audit.log"), `${JSON.stringify(opts.audit)}\n`);
  return dir;
}

export function readRestorePoint(dir: string): { before: unknown; after: unknown; audit: AuditEntry } {
  const read = (file: string): string => {
    const full = path.resolve(dir, file);
    if (!fs.existsSync(full)) throw new CliError(`Not a restore point: missing ${file} in ${dir}`);
    return fs.readFileSync(full, "utf8");
  };
  return {
    before: EJSON.parse(read("before.json")),
    after: EJSON.parse(read("after.json")),
    audit: JSON.parse(read("audit.json")) as AuditEntry,
  };
}

function normalize(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && typeof (value as { toISOString?: unknown }).toISOString === "function") {
    return (value as Date).toISOString();
  }
  return JSON.stringify(value ?? null);
}

/** Diffs exactly the named fields of two plain-ish objects, skipping any that didn't actually change. */
export function diffFields(before: object, after: object, fields: readonly string[]): FieldChange[] {
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const changes: FieldChange[] = [];
  for (const field of fields) {
    if (normalize(b[field]) !== normalize(a[field])) {
      changes.push({ field, before: b[field], after: a[field] });
    }
  }
  return changes;
}
