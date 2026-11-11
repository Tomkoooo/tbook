import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parseInput } from "@tbook/actions";
import { eventEmails } from "@tbook/modules";
import { adminEventGroupInputSchema, adminEventInputSchema, dataListKeyNormalizations } from "@tbook/schemas";
import {
  createEvent,
  createEventGroup,
  getModuleDefinition,
  listDataListsForOrg,
  listEventsForOrg,
  listGroupsForOrg,
  parseSpreadsheet,
  prepareSheetAsDataList,
  previewDataListRows,
  resolveModules,
  setEventModule,
  setOrganizationModule,
  sheetAsDataList,
} from "@tbook/services";
import { parseArgs, type Flags, requireFlag } from "../lib/args";
import { checkApplyGate, resolveOperator, writeRestorePoint } from "../lib/change";
import { connectDb, resolveOrganization } from "../lib/env";
import { CliError } from "../lib/errors";
import { confirmPhrase } from "../lib/interact";

/**
 * `setup apply --plan <file.json>`: sets up an event from a plan file —
 * modules to grant, data lists to import from spreadsheets, the event
 * group, the event (registration form, rules, modules) and its emails.
 * Everything specific to one client lives in the plan, not here.
 *
 * Dry run by default (reads the spreadsheets and validates everything,
 * writes nothing). --apply --prod-ack writes; existing data lists and
 * groups with the same name are reused, an existing event with the same
 * name stops the run. One restore point lists every id created.
 *
 * Inside the plan, "$list:<ref>" stands for the id of the data list with
 * that `ref` (in registration rules and email audiences).
 */

const listRefPattern = /^\$list:(.+)$/;

const planSchema = z.object({
  description: z.string().optional(),
  organizationModules: z.array(z.string()).default([]),
  dataLists: z
    .array(
      z.object({
        ref: z.string().min(1),
        name: z.string().min(1),
        description: z.string().default(""),
        file: z.string().min(1),
        sheet: z.string().optional(),
        keyColumn: z.string().min(1),
        keyNormalization: z.enum(dataListKeyNormalizations).default("trim_case"),
        emailColumn: z.string().nullable().default(null),
        nameColumn: z.string().nullable().default(null),
        /** Sheet columns to keep; default all. */
        columns: z.array(z.string()).optional(),
      }),
    )
    .default([]),
  group: adminEventGroupInputSchema,
  event: z.record(z.string(), z.unknown()),
  eventModules: z.record(z.string(), z.object({ enabled: z.boolean().default(true), config: z.record(z.string(), z.unknown()).optional() })).default({}),
  emails: z.array(z.record(z.string(), z.unknown())).default([]),
});
type Plan = z.infer<typeof planSchema>;

function readPlan(file: string): Plan {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) throw new CliError(`Plan file not found: ${full}`);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (error) {
    throw new CliError(`Plan file isn't valid JSON: ${(error as Error).message}`);
  }
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) throw new CliError(`Plan file is invalid:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  return parsed.data;
}

/** Replaces "$list:<ref>" strings anywhere in a JSON-like value. */
function resolveRefs<T>(value: T, ids: Map<string, string>): T {
  if (typeof value === "string") {
    const match = listRefPattern.exec(value);
    if (!match) return value;
    const id = ids.get(match[1]!);
    if (!id) throw new CliError(`Unknown data list ref "${match[1]}".`);
    return id as T;
  }
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, ids)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, ids)])) as T;
  return value;
}

async function loadSheet(entry: Plan["dataLists"][number]) {
  const file = path.resolve(entry.file);
  if (!fs.existsSync(file)) throw new CliError(`Spreadsheet not found: ${file}`);
  const sheets = await parseSpreadsheet(path.basename(file), fs.readFileSync(file));
  const sheet = entry.sheet ? sheets.find((s) => s.name === entry.sheet) : sheets.find((s) => s.rows.length > 0);
  if (!sheet) throw new CliError(`${entry.file}: sheet ${entry.sheet ? `"${entry.sheet}" ` : ""}not found.`);
  for (const column of [entry.keyColumn, entry.emailColumn, entry.nameColumn, ...(entry.columns ?? [])]) {
    if (column && !sheet.header.includes(column)) throw new CliError(`${entry.file}: no column "${column}". Columns: ${sheet.header.join(", ")}`);
  }
  return { sheet, fileName: path.basename(file) };
}

async function setupApply(flags: Flags): Promise<void> {
  const db = await connectDb(flags.get("uri"));
  const org = await resolveOrganization(requireFlag(flags, "org"));
  const plan = readPlan(requireFlag(flags, "plan"));
  const dryRun = checkApplyGate(flags) === "dry-run";

  console.log(`Database: ${db.dbName}   Organization: ${org.name} (${org.slug})`);
  if (plan.description) console.log(plan.description);

  // ---- Validate everything before writing anything ------------------------------
  for (const key of [...plan.organizationModules, ...Object.keys(plan.eventModules)]) {
    if (!getModuleDefinition(key)) throw new CliError(`Unknown module "${key}".`);
  }
  const entitled = await resolveModules({ organizationId: org.id });
  const grants = plan.organizationModules.filter((key) => !entitled.isOn(key));

  const existingLists = await listDataListsForOrg(org.id);
  const listPlans = [];
  for (const entry of plan.dataLists) {
    const { sheet, fileName } = await loadSheet(entry);
    const options = {
      name: entry.name,
      description: entry.description,
      columns: entry.columns ?? sheet.header,
      keyColumn: entry.keyColumn,
      keyNormalization: entry.keyNormalization,
      emailColumn: entry.emailColumn,
      nameColumn: entry.nameColumn,
    };
    const { input, records } = prepareSheetAsDataList(sheet, fileName, options);
    const preview = previewDataListRows(records, input.keyColumn, entry.keyNormalization);
    const existing = existingLists.find((list) => list.name === entry.name) ?? null;
    listPlans.push({ entry, sheet, fileName, options, preview, existing });
  }

  const groups = await listGroupsForOrg(org.id);
  const existingGroup = groups.find((group) => group.name === plan.group.name) ?? null;
  const eventName = String(plan.event.name ?? "");
  const clash = (await listEventsForOrg(org.id)).find((event) => event.name === eventName && (!existingGroup || String(event.groupId) === String(existingGroup._id)));
  if (clash) throw new CliError(`An event named "${eventName}" already exists (${String(clash._id)}). Nothing was written.`);

  // Validate the event and emails with placeholder ids.
  const placeholderIds = new Map(plan.dataLists.map((entry) => [entry.ref, "000000000000000000000000"]));
  const eventPreview = parseInput(adminEventInputSchema, resolveRefs({ ...plan.event, groupId: "000000000000000000000000" }, placeholderIds));
  for (const email of plan.emails) {
    if (!email.name || !email.subject || !email.trigger) throw new CliError(`Every email needs name, subject and trigger (${JSON.stringify(email.name)}).`);
  }

  // ---- Print the plan ----------------------------------------------------------------
  console.log("\nPlan:");
  console.log(`  Grant modules: ${grants.length ? grants.join(", ") : "(all already granted)"}`);
  for (const p of listPlans) {
    console.log(
      `  Data list "${p.entry.name}": ${p.existing ? `reuse existing (${p.existing.rowCount} rows)${flags.bool("replace-lists") ? " and REPLACE its rows" : ""}` : "create"} from ${p.fileName} › ${p.sheet.name}: ` +
        `${p.preview.rows} rows (key ${p.entry.keyColumn}, ${p.entry.keyNormalization}); ${p.preview.skippedEmpty} without key; ${p.preview.duplicateKeys.length} duplicate keys`,
    );
  }
  console.log(`  Event group "${plan.group.name}": ${existingGroup ? `reuse ${String(existingGroup._id)}` : "create (a new API key is printed once)"}`);
  console.log(
    `  Event "${eventPreview.name}" [${eventPreview.status}]: ${eventPreview.startDate.toISOString().slice(0, 10)} ${eventPreview.startTime ?? ""}–${eventPreview.endTime ?? ""}, ` +
      `capacity ${eventPreview.capacity ?? "∞"}, sales ${eventPreview.salesOpensAt?.toISOString() ?? "—"} → ${eventPreview.salesClosesAt?.toISOString() ?? "—"}, fee ${eventPreview.ticketFeeHuf}`,
  );
  console.log(`    Questions: ${(eventPreview.attendeeFieldSchema ?? []).map((f) => `${f.key}${f.required ? "*" : ""}`).join(", ")}`);
  console.log(`    Rules: ${eventPreview.eligibilityPreset ?? "none"} (${eventPreview.eligibilityFormRules?.rules.length ?? 0})`);
  console.log(`  Event modules: ${Object.entries(plan.eventModules).map(([k, v]) => `${k}=${v.enabled ? "on" : "off"}`).join(", ") || "(none)"}`);
  for (const email of plan.emails) console.log(`  Email "${String(email.name)}" (${String(email.trigger)}${email.audience ? `, ${String(email.audience)}` : ""})`);

  if (dryRun) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply --prod-ack to set it up.");
    return;
  }
  await confirmPhrase("SETUP", flags, "confirm", `Write all of the above to "${db.dbName}"`);

  // ---- Write ---------------------------------------------------------------------------
  const operator = resolveOperator(flags);
  const created: Record<string, unknown> = { grantedModules: [] as string[], dataLists: [] as string[], emails: [] as string[] };
  const listIds = new Map<string, string>();
  try {
    for (const key of grants) {
      await setOrganizationModule(org.id, key, { enabled: true }, null);
      (created.grantedModules as string[]).push(key);
    }
    for (const p of listPlans) {
      if (p.existing && !flags.bool("replace-lists")) {
        listIds.set(p.entry.ref, String(p.existing._id));
        continue;
      }
      const result = await sheetAsDataList(org.id, p.sheet, p.fileName, { ...p.options, listId: p.existing ? String(p.existing._id) : null });
      listIds.set(p.entry.ref, String(result.list._id));
      (created.dataLists as string[]).push(String(result.list._id));
      console.log(`  ✓ data list "${result.list.name}": ${result.imported} rows`);
    }
    let groupId = existingGroup ? String(existingGroup._id) : null;
    if (!groupId) {
      const { group, apiKey } = await createEventGroup(org.id, plan.group);
      groupId = String(group._id);
      created.groupId = groupId;
      console.log(`  ✓ group "${group.name}" ${groupId}`);
      console.log(
        flags.bool("hide-api-key")
          ? "    API key not shown (--hide-api-key): create one with “Rotate key” on the group page."
          : `    API key (shown once — store it in the storefront's env): ${apiKey}`,
      );
    }
    const eventInput = parseInput(adminEventInputSchema, resolveRefs({ ...plan.event, groupId }, listIds));
    const event = await createEvent(org.id, eventInput);
    const eventId = String(event._id);
    created.eventId = eventId;
    console.log(`  ✓ event "${event.name}" ${eventId} [${event.status}]`);
    for (const [key, state] of Object.entries(plan.eventModules)) {
      await setEventModule(org.id, eventId, key, { enabled: state.enabled, config: state.config }, null);
    }
    for (const raw of plan.emails) {
      const email = await eventEmails.createEventEmail(org.id, eventId, resolveRefs(raw, listIds) as unknown as eventEmails.EventEmailInput);
      (created.emails as string[]).push(String(email._id));
      console.log(`  ✓ email "${email.name}"`);
    }
  } finally {
    const dir = writeRestorePoint({
      entity: "setup",
      action: "apply",
      recordId: (created.eventId as string | undefined) ?? null,
      before: null,
      after: created,
      audit: {
        timestamp: new Date().toISOString(),
        operator,
        command: process.argv.slice(2),
        entity: "setup",
        action: "apply",
        organizationId: org.id,
        recordId: (created.eventId as string | undefined) ?? null,
        changes: [],
        reversible: false,
        note: "Ids created by this setup run (after.json). Remove them from the console to undo.",
      },
    });
    console.log(`\nRestore point (created ids): ${dir}`);
  }
}

export async function runSetupCommand(action: string | undefined, argv: string[]): Promise<void> {
  const flags = parseArgs(argv);
  if (action === "apply") return setupApply(flags);
  throw new CliError(`Unknown setup action "${action ?? ""}". Use: setup apply --org <slug> --plan <file.json> [--replace-lists] [--hide-api-key]`);
}
