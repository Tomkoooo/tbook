import readline from "node:readline/promises";
import type { Flags } from "./args";
import { CliError } from "./errors";
import { fmtValue } from "./format";

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function promptYesNo(question: string): Promise<boolean> {
  const answer = await ask(`${question} [y/N] `);
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export function printFieldChanges(changes: FieldChange[]): void {
  for (const change of changes) {
    console.log(`    ${change.field}: ${fmtValue(change.before)}  ->  ${fmtValue(change.after)}`);
  }
}

/**
 * The "not just yes to all" gate. Every changed field is confirmed on its
 * own: interactively, one prompt per field; non-interactively, by naming
 * it explicitly with `--confirm-field <name>` (once per changed field, so
 * a script can't blanket-approve a diff it never named). A bulk "apply
 * everything" flag is deliberately not offered.
 */
export async function confirmFieldChanges(changes: FieldChange[], flags: Flags): Promise<void> {
  if (changes.length === 0) return;

  if (isInteractive()) {
    for (const change of changes) {
      const ok = await promptYesNo(`  Apply  ${change.field}: ${fmtValue(change.before)} -> ${fmtValue(change.after)} ?`);
      if (!ok) throw new CliError(`Aborted: "${change.field}" was not confirmed.`);
    }
    return;
  }

  const confirmed = new Set(flags.getAll("confirm-field"));
  const missing = changes.filter((change) => !confirmed.has(change.field));
  if (missing.length > 0) {
    throw new CliError(
      "Non-interactive run: pass --confirm-field <name> once for each changed field above.\n" +
        `Missing confirmation for: ${missing.map((m) => m.field).join(", ")}`,
    );
  }
}

/** Extra friction for a delete-shaped action: type the record's own name back. */
export async function confirmExactText(expected: string, flags: Flags, flagName: string, prompt: string): Promise<void> {
  if (isInteractive()) {
    const typed = await ask(`${prompt} — type it exactly to continue: `);
    if (typed !== expected) throw new CliError("Confirmation text did not match. Aborted.");
    return;
  }
  const given = flags.get(flagName);
  if (given !== expected) {
    throw new CliError(`Non-interactive run: pass --${flagName}="${expected}" to confirm.`);
  }
}

/** A literal-phrase gate for an action with no field diff to confirm (e.g. sending a real email). */
export async function confirmPhrase(phrase: string, flags: Flags, flagName: string, prompt: string): Promise<void> {
  if (isInteractive()) {
    const typed = await ask(`${prompt} — type ${phrase} to continue: `);
    if (typed !== phrase) throw new CliError("Confirmation phrase did not match. Aborted.");
    return;
  }
  const given = flags.get(flagName);
  if (given !== phrase) {
    throw new CliError(`Non-interactive run: pass --${flagName}=${phrase} to confirm.`);
  }
}
