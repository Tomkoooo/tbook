import { adminEventGroupInputSchema, type AdminEventGroupInput } from "@tbook/schemas";
import {
  getGroupForOrg,
  listGroupsForOrg,
  revealEventGroupPreviewKey,
  rotateEventGroupApiKey,
  rotateEventGroupPreviewKey,
  updateEventGroup,
} from "@tbook/services";
import { parseArgs, type Flags, requireFlag } from "../lib/args";
import { type AuditEntry, checkApplyGate, diffFields, resolveOperator, writeRestorePoint } from "../lib/change";
import { connectDb, resolveOrganization, type ResolvedOrg } from "../lib/env";
import { CliError } from "../lib/errors";
import { table } from "../lib/format";
import { confirmFieldChanges, confirmPhrase, printFieldChanges } from "../lib/interact";

/**
 * Event group CRUD — scalar fields only; keys have their own actions
 * (`group keys`: hints, reveal the preview key, rotate either key — a new
 * key is printed once). Same safety model
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

/**
 * `group keys --org <org> --id <group>`: the API key hint and the preview
 * key (revealed with --reveal-preview). The API key itself is stored only
 * as a hash, so it can't be shown again: --rotate-api-key issues a new one
 * (the old stops working at once), --rotate-preview a new preview key.
 * Rotations are writes: --apply --prod-ack and the ROTATE phrase.
 */
async function groupKeys(flags: Flags): Promise<void> {
  await connectDb(flags.get("uri"));
  const org = await resolveOrganization(requireFlag(flags, "org"));
  const id = requireFlag(flags, "id");
  const group = await getGroupForOrg(org.id, id);
  console.log(`Group "${group.name}" (${id}) in "${org.name}":`);
  console.log(`  API key:     ${group.apiKeyHint} (created ${group.apiKeyCreatedAt?.toISOString?.() ?? "?"}; stored as a hash — rotate to get a new one)`);
  console.log(`  Preview key: ${group.previewKeyHint || "(none)"}${group.previewKeyCreatedAt ? ` (created ${group.previewKeyCreatedAt.toISOString()})` : ""}`);

  const rotateApi = flags.bool("rotate-api-key");
  const rotatePreview = flags.bool("rotate-preview");
  if (flags.bool("reveal-preview") && !rotatePreview) {
    const key = await revealEventGroupPreviewKey(org.id, id);
    console.log(key ? `  Preview key (X-TBook-Preview): ${key}` : "  No readable preview key — create one with --rotate-preview.");
  }
  if (!rotateApi && !rotatePreview) return;

  const what = [rotateApi ? "a new API key (the current one stops working immediately)" : null, rotatePreview ? "a new preview key" : null].filter(Boolean).join(" and ");
  console.log(`\nWill issue ${what}.`);
  if (checkApplyGate(flags) === "dry-run") {
    console.log("DRY RUN — nothing written. Re-run with --apply --prod-ack to write.");
    return;
  }
  await confirmPhrase("ROTATE", flags, "confirm", `Issue ${what} for "${group.name}"`);
  const before = { apiKeyHint: group.apiKeyHint, previewKeyHint: group.previewKeyHint ?? "" };
  const printed: string[] = [];
  if (rotateApi) {
    const { apiKey } = await rotateEventGroupApiKey(org.id, id);
    printed.push(`  API key (shown once — put it in the site's config): ${apiKey}`);
  }
  if (rotatePreview) {
    const { previewKey } = await rotateEventGroupPreviewKey(org.id, id);
    printed.push(`  Preview key (X-TBook-Preview): ${previewKey}`);
  }
  const after = await getGroupForOrg(org.id, id);
  // The restore point records hints only, never the keys.
  const dir = writeRestorePoint({
    entity: "group",
    action: "keys",
    recordId: id,
    before,
    after: { apiKeyHint: after.apiKeyHint, previewKeyHint: after.previewKeyHint ?? "" },
    audit: {
      timestamp: new Date().toISOString(),
      operator: resolveOperator(flags),
      command: process.argv.slice(2),
      entity: "group",
      action: "keys",
      organizationId: org.id,
      recordId: id,
      changes: [
        ...(rotateApi ? [{ field: "apiKey", before: before.apiKeyHint, after: after.apiKeyHint }] : []),
        ...(rotatePreview ? [{ field: "previewKey", before: before.previewKeyHint, after: after.previewKeyHint ?? "" }] : []),
      ],
      reversible: false,
      note: "Key rotation; the old key can't be restored.",
    },
  });
  for (const line of printed) console.log(line);
  console.log(`\nSaved. Restore point (hints only): ${dir}`);
}

export async function runGroupCommand(action: string | undefined, argv: string[]): Promise<void> {
  const flags = parseArgs(argv);
  switch (action) {
    case "list":
      return groupList(flags);
    case "edit":
      return groupEdit(flags);
    case "keys":
      return groupKeys(flags);
    default:
      throw new CliError(`Unknown "group" action "${action ?? ""}". Try: list, edit, keys.`);
  }
}
