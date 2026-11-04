import { adminEventGroupInputSchema, type AdminEventGroupInput } from "@tbook/schemas";
import { getGroupForOrg, listGroupsForOrg, updateEventGroup } from "@tbook/services";
import { parseArgs, type Flags, requireFlag } from "../lib/args";
import { type AuditEntry, checkApplyGate, diffFields, resolveOperator, writeRestorePoint } from "../lib/change";
import { connectDb, resolveOrganization, type ResolvedOrg } from "../lib/env";
import { CliError } from "../lib/errors";
import { table } from "../lib/format";
import { confirmFieldChanges, printFieldChanges } from "../lib/interact";

/**
 * Event group CRUD — scalar fields only (an API key is never shown or
 * editable here; use the admin console's "Rotate key"). Same safety model
 * as `event edit`: dry run by default, one restore point per write. No
 * `undo` yet — groups change rarely enough that this hasn't been needed.
 */

type FieldKind = "string" | "number" | "boolean";

const EDITABLE_GROUP_FIELDS: Record<string, FieldKind> = {
  name: "string",
  description: "string",
  status: "string",
  defaultPriceBasis: "string",
  defaultVatPercent: "number",
  listOnTBookSite: "boolean",
  listingTitle: "string",
  listingUrl: "string",
};

function castSetValue(raw: string, kind: FieldKind): unknown {
  if (kind === "string") return raw;
  if (kind === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new CliError(`Expected true/false, got "${raw}"`);
  }
  const n = Number(raw);
  if (Number.isNaN(n)) throw new CliError(`Not a number: "${raw}"`);
  return n;
}

function parseSetFlags(flags: Flags): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const raw of flags.getAll("set")) {
    const eq = raw.indexOf("=");
    if (eq === -1) throw new CliError(`--set must be field=value, got "${raw}"`);
    const field = raw.slice(0, eq);
    const value = raw.slice(eq + 1);
    const kind = EDITABLE_GROUP_FIELDS[field];
    if (!kind) throw new CliError(`"${field}" isn't editable from the CLI. Editable fields: ${Object.keys(EDITABLE_GROUP_FIELDS).join(", ")}.`);
    out[field] = castSetValue(value, kind);
  }
  return out;
}

interface RawGroupDoc {
  name: string;
  description?: string | null;
  status: string;
  defaultPriceBasis: string;
  defaultVatPercent: number;
  listOnTBookSite?: boolean;
  listingTitle?: string | null;
  listingUrl?: string | null;
}

function groupToAdminInput(group: RawGroupDoc): Record<string, unknown> {
  return {
    name: group.name,
    description: group.description ?? "",
    status: group.status,
    defaultPriceBasis: group.defaultPriceBasis,
    defaultVatPercent: group.defaultVatPercent,
    listOnTBookSite: group.listOnTBookSite ?? false,
    listingTitle: group.listingTitle ?? "",
    listingUrl: group.listingUrl ?? "",
  };
}

function auditEntry(opts: { flags: Flags; org: ResolvedOrg; recordId: string; changes: ReturnType<typeof diffFields> }): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    operator: resolveOperator(opts.flags),
    command: process.argv.slice(2),
    entity: "group",
    action: "edit",
    organizationId: opts.org.id,
    recordId: opts.recordId,
    changes: opts.changes,
    reversible: true,
  };
}

async function groupList(flags: Flags): Promise<void> {
  await connectDb(flags.get("uri"));
  const org = await resolveOrganization(requireFlag(flags, "org"));
  const groups = await listGroupsForOrg(org.id);
  console.log(`Organization: ${org.name} (${org.slug})`);
  console.log(table(groups.map((g) => ({ id: String(g._id), name: g.name, status: g.status })), ["id", "name", "status"]));
}

async function groupEdit(flags: Flags): Promise<void> {
  await connectDb(flags.get("uri"));
  const org = await resolveOrganization(requireFlag(flags, "org"));
  const id = requireFlag(flags, "id");
  const sets = parseSetFlags(flags);
  if (Object.keys(sets).length === 0) throw new CliError("Nothing to edit — pass at least one --set field=value.");

  const existing = await getGroupForOrg(org.id, id);
  const currentInput = groupToAdminInput(existing as unknown as RawGroupDoc);
  const nextInput = { ...currentInput, ...sets } as AdminEventGroupInput;
  const parsed = adminEventGroupInputSchema.parse(nextInput);
  const changes = diffFields(currentInput, parsed, Object.keys(sets));

  console.log(`Group "${existing.name}" (${id}) in "${org.name}":`);
  if (changes.length === 0) {
    console.log("  No effective change — the new value already matches the current one.");
    return;
  }
  printFieldChanges(changes);

  if (checkApplyGate(flags) === "dry-run") {
    console.log("\nDRY RUN — nothing written. Re-run with --apply --prod-ack to write.");
    return;
  }
  await confirmFieldChanges(changes, flags);

  const updated = await updateEventGroup(org.id, id, parsed);
  const dir = writeRestorePoint({
    entity: "group",
    action: "edit",
    recordId: id,
    before: existing.toObject(),
    after: updated.toObject(),
    audit: auditEntry({ flags, org, recordId: id, changes }),
  });
  console.log(`\nSaved. Restore point: ${dir}`);
}

export async function runGroupCommand(action: string | undefined, argv: string[]): Promise<void> {
  const flags = parseArgs(argv);
  switch (action) {
    case "list":
      return groupList(flags);
    case "edit":
      return groupEdit(flags);
    default:
      throw new CliError(`Unknown "group" action "${action ?? ""}". Try: list, edit.`);
  }
}
