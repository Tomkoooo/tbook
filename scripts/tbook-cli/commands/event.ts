import { ActionError, parseInput } from "@tbook/actions";
import type { IEvent } from "@tbook/db";
import { adminEventInputSchema, type AdminEventInput } from "@tbook/schemas";
import { createEvent, getEventForOrg, getOrganizationSettings, listEventsForOrg, listGroupsForOrg, updateEvent } from "@tbook/services";
import { parseArgs, type Flags, requireFlag } from "../lib/args";
import { type AuditEntry, checkApplyGate, diffFields, readRestorePoint, resolveOperator, writeRestorePoint } from "../lib/change";
import { connectDb, resolveOrganization, type ResolvedOrg } from "../lib/env";
import { CliError } from "../lib/errors";
import { fmtValue, printKeyValues, table } from "../lib/format";
import { confirmExactText, confirmFieldChanges, type FieldChange, printFieldChanges } from "../lib/interact";

/**
 * Event CRUD, routed entirely through packages/services' catalog-admin-
 * service (createEvent/updateEvent/getEventForOrg/listEventsForOrg) — the
 * same functions the admin console's catalog-actions.ts calls. "Delete" is
 * the soft kind the console already has: status -> "archived"; the
 * service layer has no hard delete, and this CLI doesn't add one.
 *
 * Structured sub-objects (dayPass, pricingRules, attendeeFieldSchema,
 * eligibility*) aren't editable via --set yet — only the scalar fields a
 * console operator would change one at a time. Use the admin console for
 * those; this keeps the CLI's first cut scoped to what it can confirm and
 * diff field-by-field.
 */

type FieldKind = "string" | "number" | "boolean" | "date" | "nullableString" | "nullableNumber" | "nullableDate";

const EDITABLE_EVENT_FIELDS: Record<string, FieldKind> = {
  groupId: "string",
  name: "string",
  description: "string",
  address: "string",
  startDate: "date",
  endDate: "date",
  startTime: "nullableString",
  endTime: "nullableString",
  salesOpensAt: "nullableDate",
  salesClosesAt: "nullableDate",
  currency: "string",
  ticketFeeHuf: "number",
  ticketFeeMode: "string",
  registrationUnit: "string",
  playersPerTicket: "number",
  ticketPriceBasis: "string",
  ticketVatPercent: "number",
  capacity: "nullableNumber",
  vouchersEnabled: "boolean",
  publicListing: "string",
  status: "string",
  tdartsEnabled: "boolean",
  tdartsTournamentCode: "nullableString",
};

const REQUIRED_ON_CREATE = ["groupId", "name", "startDate", "endDate", "ticketFeeHuf"];

function castSetValue(raw: string, kind: FieldKind): unknown {
  if (kind.startsWith("nullable") && raw.toLowerCase() === "null") return null;
  if (kind === "string" || kind === "nullableString") return raw;
  if (kind === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new CliError(`Expected true/false, got "${raw}"`);
  }
  if (kind === "number" || kind === "nullableNumber") {
    const n = Number(raw);
    if (Number.isNaN(n)) throw new CliError(`Not a number: "${raw}"`);
    return n;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new CliError(`Not a valid date: "${raw}"`);
  return d;
}

function parseSetFlags(flags: Flags): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const raw of flags.getAll("set")) {
    const eq = raw.indexOf("=");
    if (eq === -1) throw new CliError(`--set must be field=value, got "${raw}"`);
    const field = raw.slice(0, eq);
    const value = raw.slice(eq + 1);
    const kind = EDITABLE_EVENT_FIELDS[field];
    if (!kind) {
      throw new CliError(
        `"${field}" isn't editable from the CLI. Editable fields: ${Object.keys(EDITABLE_EVENT_FIELDS).join(", ")}.\n` +
          "Structured fields (dayPass, pricingRules, attendeeFieldSchema, eligibility*) need the admin console.",
      );
    }
    out[field] = castSetValue(value, kind);
  }
  return out;
}

/**
 * The shape eventToAdminInput reads from — loose on purpose, since it has
 * to accept both a live IEvent's `.toObject()` and an EJSON-parsed
 * before.json from a restore point.
 */
interface RawEventDoc {
  groupId?: unknown;
  name: string;
  description?: string | null;
  location?: { address?: string | null } | null;
  startDate: Date;
  endDate: Date;
  startTime?: string | null;
  endTime?: string | null;
  salesOpensAt?: Date | null;
  salesClosesAt?: Date | null;
  currency: string;
  kind?: string | null;
  dayPass?: unknown;
  ticketFeeHuf: number;
  ticketFeeMode: string;
  registrationUnit: string;
  playersPerTicket: number;
  ticketPriceBasis: string;
  ticketVatPercent: number;
  capacity?: number | null;
  vouchersEnabled: boolean;
  publicListing: string;
  status: string;
  tdarts?: { enabled?: boolean; tournamentCode?: string | null } | null;
  attendeeFieldSchema?: unknown[];
  attendeeFieldSchemaMode?: string;
  eligibilityPreset?: string;
  eligibilityMinAge?: number | null;
  eligibilityMaxAge?: number | null;
  eligibilityAllowedGenders?: string[];
  eligibilityBirthDateFieldKey?: string | null;
  eligibilityGenderFieldKey?: string | null;
  eligibilityFormRules?: unknown;
  pricingRules?: unknown[];
}

/** Mirrors apps/web's event-form mapping (IEvent -> AdminEventInput) so edit/undo see exactly what the console would. */
function eventToAdminInput(event: RawEventDoc): Record<string, unknown> {
  return {
    groupId: String(event.groupId ?? ""),
    name: event.name,
    description: event.description ?? "",
    address: event.location?.address ?? "",
    startDate: event.startDate,
    endDate: event.endDate,
    startTime: event.startTime ?? null,
    endTime: event.endTime ?? null,
    salesOpensAt: event.salesOpensAt ?? null,
    salesClosesAt: event.salesClosesAt ?? null,
    currency: event.currency,
    kind: event.kind ?? "standard",
    dayPass: event.dayPass ?? null,
    ticketFeeHuf: event.ticketFeeHuf,
    ticketFeeMode: event.ticketFeeMode,
    registrationUnit: event.registrationUnit,
    playersPerTicket: event.playersPerTicket,
    ticketPriceBasis: event.ticketPriceBasis,
    ticketVatPercent: event.ticketVatPercent,
    capacity: event.capacity ?? null,
    vouchersEnabled: event.vouchersEnabled,
    publicListing: event.publicListing,
    status: event.status,
    tdartsEnabled: event.tdarts?.enabled ?? false,
    tdartsTournamentCode: event.tdarts?.tournamentCode ?? null,
    attendeeFieldSchema: event.attendeeFieldSchema ?? [],
    attendeeFieldSchemaMode: event.attendeeFieldSchemaMode ?? "extend",
    eligibilityPreset: event.eligibilityPreset ?? "none",
    eligibilityMinAge: event.eligibilityMinAge ?? null,
    eligibilityMaxAge: event.eligibilityMaxAge ?? null,
    eligibilityAllowedGenders: event.eligibilityAllowedGenders ?? [],
    eligibilityBirthDateFieldKey: event.eligibilityBirthDateFieldKey ?? null,
    eligibilityGenderFieldKey: event.eligibilityGenderFieldKey ?? null,
    eligibilityFormRules: event.eligibilityFormRules ?? null,
    pricingRules: event.pricingRules ?? [],
  };
}

function auditEntry(opts: {
  flags: Flags;
  action: string;
  org: ResolvedOrg;
  recordId: string | null;
  changes: FieldChange[];
  reversible: boolean;
  note?: string;
}): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    operator: resolveOperator(opts.flags),
    command: process.argv.slice(2),
    entity: "event",
    action: opts.action,
    organizationId: opts.org.id,
    recordId: opts.recordId,
    changes: opts.changes,
    reversible: opts.reversible,
    note: opts.note,
  };
}

function undoHint(org: ResolvedOrg, dir: string): string {
  return `Undo: npx tsx scripts/tbook-cli/cli.ts event undo --org ${org.id} --dir ${dir}`;
}

async function eventList(flags: Flags): Promise<void> {
  await connectDb(flags.get("uri"));
  const org = await resolveOrganization(requireFlag(flags, "org"));
  const events = await listEventsForOrg(org.id);

  const status = flags.get("status");
  const kind = flags.get("kind");
  const q = flags.get("q")?.toLowerCase();
  const filtered = events.filter(
    (e) => (!status || e.status === status) && (!kind || (e.kind ?? "standard") === kind) && (!q || e.name.toLowerCase().includes(q)),
  );
  const limit = Number(flags.get("limit") ?? 50);
  const shown = filtered.slice(0, limit);

  console.log(`Organization: ${org.name} (${org.slug})`);
  console.log(
    table(
      shown.map((e) => ({
        id: String(e._id),
        name: e.name,
        status: e.status,
        kind: e.kind ?? "standard",
        start: e.startDate.toISOString().slice(0, 10),
        end: e.endDate.toISOString().slice(0, 10),
        capacity: e.capacity === null ? "unlimited" : String(e.capacity),
        sold: String(e.soldGuestCount),
      })),
      ["id", "name", "status", "kind", "start", "end", "capacity", "sold"],
    ),
  );
  console.log(`\n${shown.length} of ${filtered.length} matching event(s) shown (${events.length} total in org).`);
}

async function eventShow(flags: Flags): Promise<void> {
  await connectDb(flags.get("uri"));
  const org = await resolveOrganization(requireFlag(flags, "org"));
  const event = await getEventForOrg(org.id, requireFlag(flags, "id"));

  console.log(`Organization: ${org.name} (${org.slug})`);
  printKeyValues({
    id: String(event._id),
    organizationId: event.organizationId,
    groupId: event.groupId,
    name: event.name,
    status: event.status,
    kind: event.kind,
    startDate: event.startDate,
    endDate: event.endDate,
    currency: event.currency,
    ticketFeeHuf: event.ticketFeeHuf,
    ticketFeeMode: event.ticketFeeMode,
    registrationUnit: event.registrationUnit,
    capacity: event.capacity,
    soldGuestCount: event.soldGuestCount,
    publicListing: event.publicListing,
    vouchersEnabled: event.vouchersEnabled,
    tdarts: event.tdarts,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  });
}

async function eventCreate(flags: Flags): Promise<void> {
  await connectDb(flags.get("uri"));
  const org = await resolveOrganization(requireFlag(flags, "org"));
  const sets = parseSetFlags(flags);

  const missing = REQUIRED_ON_CREATE.filter((f) => !(f in sets));
  if (missing.length > 0) throw new CliError(`event create needs --set for: ${missing.join(", ")}`);

  const { currency: orgCurrency } = await getOrganizationSettings(org.id);
  const defaults: AdminEventInput = {
    groupId: "",
    name: "",
    description: "",
    address: "",
    startDate: new Date(),
    endDate: new Date(),
    startTime: null,
    endTime: null,
    salesOpensAt: null,
    salesClosesAt: null,
    currency: orgCurrency,
    kind: "standard",
    dayPass: null,
    ticketFeeHuf: 0,
    ticketFeeMode: "per_person",
    registrationUnit: "person",
    playersPerTicket: 1,
    ticketPriceBasis: "net",
    ticketVatPercent: 27,
    capacity: null,
    vouchersEnabled: true,
    publicListing: "listed",
    status: "draft",
    tdartsEnabled: false,
    tdartsTournamentCode: null,
  };
  const input = parseInput(adminEventInputSchema, { ...defaults, ...sets });

  console.log(`Would create an event in "${org.name}":`);
  for (const [field, value] of Object.entries(sets)) console.log(`    ${field}: ${fmtValue(value)}`);
  console.log("  (every other field takes its normal default — draft, standard, no capacity cap, listed.)");

  if (checkApplyGate(flags) === "dry-run") {
    console.log("\nDRY RUN — nothing written. Re-run with --apply --prod-ack to create it.");
    return;
  }

  const changes: FieldChange[] = Object.entries(sets).map(([field, value]) => ({ field, before: null, after: value }));
  await confirmFieldChanges(changes, flags);

  const created = await createEvent(org.id, input);
  const dir = writeRestorePoint({
    entity: "event",
    action: "create",
    recordId: String(created._id),
    before: null,
    after: created.toObject(),
    audit: auditEntry({ flags, action: "create", org, recordId: String(created._id), changes, reversible: true }),
  });
  console.log(`\nCreated event ${created._id}. Restore point: ${dir}`);
  console.log(`(Undo archives it — creation has no hard undo.) ${undoHint(org, dir)}`);
}

async function eventEdit(flags: Flags): Promise<void> {
  await connectDb(flags.get("uri"));
  const org = await resolveOrganization(requireFlag(flags, "org"));
  const id = requireFlag(flags, "id");
  const sets = parseSetFlags(flags);
  if (Object.keys(sets).length === 0) throw new CliError("Nothing to edit — pass at least one --set field=value.");

  const existing = await getEventForOrg(org.id, id);
  const currentInput = eventToAdminInput(existing.toObject() as unknown as RawEventDoc);
  const nextInput = parseInput(adminEventInputSchema, { ...currentInput, ...sets });
  const changes = diffFields(currentInput, nextInput, Object.keys(sets));

  console.log(`Event "${existing.name}" (${id}) in "${org.name}":`);
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

  const updated = await updateEvent(org.id, id, nextInput);
  const dir = writeRestorePoint({
    entity: "event",
    action: "edit",
    recordId: id,
    before: existing.toObject(),
    after: updated.toObject(),
    audit: auditEntry({ flags, action: "edit", org, recordId: id, changes, reversible: true }),
  });
  console.log(`\nSaved. Restore point: ${dir}`);
  console.log(undoHint(org, dir));
}

/** Shared by `event archive` and `event undo`'s create-rollback path. */
async function archiveLoadedEvent(org: ResolvedOrg, existing: IEvent, flags: Flags): Promise<void> {
  const id = String(existing._id);
  console.log(`Event "${existing.name}" (${id}) in "${org.name}" — current status: ${existing.status}`);
  if (existing.status === "archived") {
    console.log("  Already archived. Nothing to do.");
    return;
  }

  const currentInput = eventToAdminInput(existing.toObject() as unknown as RawEventDoc);
  const nextInput = parseInput(adminEventInputSchema, { ...currentInput, status: "archived" });
  const changes: FieldChange[] = [{ field: "status", before: existing.status, after: "archived" }];
  printFieldChanges(changes);

  if (checkApplyGate(flags) === "dry-run") {
    console.log("\nDRY RUN (soft-delete) — nothing written. Re-run with --apply --prod-ack to write.");
    return;
  }

  await confirmFieldChanges(changes, flags);
  await confirmExactText(existing.name, flags, "confirm-name", `This archives (soft-deletes) "${existing.name}"`);

  const updated = await updateEvent(org.id, id, nextInput);
  const dir = writeRestorePoint({
    entity: "event",
    action: "archive",
    recordId: id,
    before: existing.toObject(),
    after: updated.toObject(),
    audit: auditEntry({
      flags,
      action: "archive",
      org,
      recordId: id,
      changes,
      reversible: true,
      note: "Soft-delete: status set to archived. The service layer has no hard delete.",
    }),
  });
  console.log(`\nArchived. Restore point: ${dir}`);
  console.log(`(Undo unarchives it.) ${undoHint(org, dir)}`);
}

async function eventArchive(flags: Flags): Promise<void> {
  await connectDb(flags.get("uri"));
  const org = await resolveOrganization(requireFlag(flags, "org"));
  const existing = await getEventForOrg(org.id, requireFlag(flags, "id"));
  await archiveLoadedEvent(org, existing, flags);
}

async function eventUndo(flags: Flags): Promise<void> {
  await connectDb(flags.get("uri"));
  const org = await resolveOrganization(requireFlag(flags, "org"));
  const dir = requireFlag(flags, "dir");
  const { before, audit } = readRestorePoint(dir);

  if (audit.entity !== "event") throw new CliError(`${dir} is a restore point for "${audit.entity}", not "event".`);
  if (audit.organizationId !== org.id) {
    throw new CliError(`Organization mismatch: this restore point belongs to org ${audit.organizationId}, not ${org.id}.`);
  }
  const recordId = audit.recordId;
  if (!recordId) throw new CliError("This restore point has no record id to undo.");

  if (audit.action === "create") {
    console.log(`"${recordId}" was created by this restore point. There is no hard delete, so undo archives it instead.`);
    const existing = await getEventForOrg(org.id, recordId).catch((error: unknown) => {
      if (error instanceof ActionError) return null;
      throw error;
    });
    if (!existing) {
      console.log("  It no longer exists. Nothing to do.");
      return;
    }
    await archiveLoadedEvent(org, existing, flags);
    return;
  }

  const existing = await getEventForOrg(org.id, recordId);
  const beforeInput = eventToAdminInput(before as RawEventDoc);
  const nextInput = parseInput(adminEventInputSchema, beforeInput);
  const currentInput = eventToAdminInput(existing.toObject() as unknown as RawEventDoc);
  const changes = diffFields(currentInput, nextInput, Object.keys(EDITABLE_EVENT_FIELDS));

  console.log(`Undo of "${audit.action}" on event "${existing.name}" (${recordId}), restoring its state from ${dir}:`);
  if (changes.length === 0) {
    console.log("  Current state already matches the restore point. Nothing to do.");
    return;
  }
  printFieldChanges(changes);

  if (checkApplyGate(flags) === "dry-run") {
    console.log("\nDRY RUN — nothing written. Re-run with --apply --prod-ack to write.");
    return;
  }
  await confirmFieldChanges(changes, flags);

  const updated = await updateEvent(org.id, recordId, nextInput);
  const newDir = writeRestorePoint({
    entity: "event",
    action: "undo",
    recordId,
    before: existing.toObject(),
    after: updated.toObject(),
    audit: auditEntry({ flags, action: "undo", org, recordId, changes, reversible: true, note: `Undo of ${dir}` }),
  });
  console.log(`\nRestored. New restore point (in case this undo itself needs undoing): ${newDir}`);
}

async function eventGroups(flags: Flags): Promise<void> {
  await connectDb(flags.get("uri"));
  const org = await resolveOrganization(requireFlag(flags, "org"));
  const groups = await listGroupsForOrg(org.id);
  console.log(`Organization: ${org.name} (${org.slug})`);
  console.log(table(groups.map((g) => ({ id: String(g._id), name: g.name, status: g.status })), ["id", "name", "status"]));
}

export async function runEventCommand(action: string | undefined, argv: string[]): Promise<void> {
  const flags = parseArgs(argv);
  switch (action) {
    case "list":
      return eventList(flags);
    case "show":
      return eventShow(flags);
    case "create":
      return eventCreate(flags);
    case "edit":
      return eventEdit(flags);
    case "archive":
      return eventArchive(flags);
    case "undo":
      return eventUndo(flags);
    case "groups":
      return eventGroups(flags);
    default:
      throw new CliError(`Unknown "event" action "${action ?? ""}". Try: list, show, create, edit, archive, undo, groups.`);
  }
}
