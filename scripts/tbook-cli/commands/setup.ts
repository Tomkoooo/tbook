import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parseInput } from "@tbook/actions";
import { busTransport, eventEmails } from "@tbook/modules";
import { adminEventGroupInputSchema, adminEventInputSchema, dataListKeyNormalizations } from "@tbook/schemas";
import {
  cleanModuleConfig,
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
  sanitizeRichText,
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
 *
 * `--update` is for an event the plan already created: it brings the
 * module grants, the event's module switches and settings, and the emails
 * (matched by name; `--email <name>` limits it to some) in line with the
 * plan. It never touches the event's own fields (status, dates, form),
 * the group or the data lists. Plan settings left empty ("") don't erase
 * a value set in the console. Dry run first, then --apply --prod-ack and
 * the UPDATE phrase; the restore point holds everything it changed.
 *
 * `busRoutes` (optional) are the event's buses, matched by `code`: missing
 * ones are created, listed ones updated (city, capacity, stops always from
 * the plan; other fields only when the plan gives a non-empty value, so a
 * captain entered in the console stays). Booked seats are never touched and
 * buses not in the plan are left alone. Stop times are ISO date-times.
 */

const isoDateTime = z.string().refine((value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && !Number.isNaN(Date.parse(value)), "an ISO date-time, e.g. 2026-12-05T13:30:00+01:00");

const busRouteSchema = z.object({
  code: z.string().trim().min(1),
  city: z.string().trim().min(1),
  capacity: z.number().int().min(1),
  returnInfo: z.string().optional(),
  captainName: z.string().optional(),
  captainPhone: z.string().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  notes: z.string().optional(),
  stops: z.array(z.object({ city: z.string().trim().min(1), pickupPoint: z.string().default(""), departureAt: isoDateTime })).default([]),
});
type PlanBusRoute = z.infer<typeof busRouteSchema>;

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
  busRoutes: z.array(busRouteSchema).default([]),
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
  const codes = new Set<string>();
  for (const route of parsed.data.busRoutes) {
    if (codes.has(route.code)) throw new CliError(`Plan file is invalid: bus code "${route.code}" appears twice in busRoutes.`);
    codes.add(route.code);
  }
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
  if (flags.bool("update")) return setupUpdate(flags, plan, org, db.dbName, dryRun);

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
  validateEmailTriggers(plan.emails);

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
  for (const route of plan.busRoutes) console.log(`  Bus ${route.code} "${route.city}" (${route.capacity} seats, ${route.stops.length} stops)`);

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
    if (plan.busRoutes.length > 0) created.busRoutes = await applyRouteChanges(org.id, eventId, (await planBusRoutes(eventId, plan.busRoutes)).changes);
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

// ---- --update ------------------------------------------------------------------------

type ModuleMap = Record<string, { enabled?: boolean; config?: Record<string, unknown> } | undefined>;

function plainObject<T>(value: T): T {
  return value == null ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** Plan config over the stored one; an empty plan value keeps what is stored. */
function mergedConfig(key: string, stored: Record<string, unknown> | undefined, planned: Record<string, unknown> | undefined): Record<string, string> {
  const merged: Record<string, unknown> = { ...(stored ?? {}) };
  for (const [field, value] of Object.entries(planned ?? {})) {
    if (value === "" || value == null) continue;
    merged[field] = value;
  }
  return cleanModuleConfig(key, merged);
}

/**
 * Triggers: "on_registration", "manual", or a system trigger
 * (waitlist_joined, waitlist_offer, waitlist_registered, bus_seat_freed,
 * bus_captain_notice, booking_cancelled) — the event's text for a module's own guest email;
 * at most one email per system trigger.
 */
export function validateEmailTriggers(emails: Array<Record<string, unknown>>): void {
  const seen = new Set<string>();
  for (const email of emails) {
    const trigger = String(email.trigger ?? "");
    if (!(eventEmails.emailTriggers as readonly string[]).includes(trigger)) {
      throw new CliError(`Email "${String(email.name)}": unknown trigger "${trigger}" (use one of: ${eventEmails.emailTriggers.join(", ")}).`);
    }
    if (eventEmails.isSystemEmailTrigger(trigger)) {
      if (seen.has(trigger)) throw new CliError(`More than one email with the system trigger "${trigger}" — an event has at most one.`);
      seen.add(trigger);
    }
  }
}

const EMAIL_FIELDS = ["subject", "body", "trigger", "audience", "listId", "listMatchFieldKey", "conditions", "attachTicket", "active", "sortOrder"] as const;

function emailComparable(email: Record<string, unknown>): Record<string, unknown> {
  return {
    subject: String(email.subject ?? "").trim(),
    body: String(email.body ?? ""),
    trigger: email.trigger,
    audience: email.trigger === "manual" ? (email.audience ?? "registered") : "registered",
    listId: email.listId ? String(email.listId) : null,
    listMatchFieldKey: email.listMatchFieldKey ?? null,
    conditions: email.conditions && (email.conditions as { rules?: unknown[] }).rules?.length ? plainObject(email.conditions) : null,
    attachTicket: Boolean(email.attachTicket),
    active: email.active ?? true,
    sortOrder: Number(email.sortOrder ?? 0),
  };
}

function short(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

// ---- Bus routes ------------------------------------------------------------------------

interface RouteChange {
  code: string;
  id: string | null;
  input: busTransport.BusRouteInput;
  lines: string[];
  before: unknown;
}

function stopsText(stops: Array<{ city: string; pickupPoint: string; departureAt: Date | null }>): string {
  return stops.length === 0 ? "(none)" : stops.map((stop) => `${stop.departureAt ? stop.departureAt.toISOString() : "?"} ${stop.city}${stop.pickupPoint ? ` – ${stop.pickupPoint}` : ""}`).join("; ");
}

/** An ISO date-time; without an offset ("2026-12-05T13:30") it is Budapest time. */
function stopTime(value: string): Date {
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) return new Date(value);
  const [, y, m, d, hh, mm] = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)!.map(Number) as number[];
  return busTransport.budapestToUtc(y!, m!, d!, hh!, mm!);
}

/** The plan's buses against the stored ones: what to create / update, with a readable diff. */
export async function planBusRoutes(eventId: string, planned: PlanBusRoute[]): Promise<{ changes: RouteChange[]; untouched: string[]; kept: string[] }> {
  const stored = await busTransport.listRoutes(eventId);
  const changes: RouteChange[] = [];
  const untouched: string[] = [];
  const keep = (value: string | undefined, current: string) => (value != null && value.trim() !== "" ? value.trim() : current);
  for (const [index, route] of planned.entries()) {
    const stops = route.stops.map((stop) => ({ city: stop.city.trim(), pickupPoint: stop.pickupPoint.trim(), departureAt: stopTime(stop.departureAt) }));
    const existing = stored.find((r) => r.code === route.code);
    const input: busTransport.BusRouteInput = {
      code: route.code,
      city: route.city,
      // The bus's own pickup = its first stop (what an answer without a stop shows).
      pickupPoint: stops[0]?.pickupPoint ?? existing?.pickupPoint ?? "",
      departureAt: stops[0]?.departureAt ?? existing?.departureAt ?? null,
      capacity: route.capacity,
      returnInfo: keep(route.returnInfo, existing?.returnInfo ?? ""),
      captainName: keep(route.captainName, existing?.captainName ?? ""),
      captainPhone: keep(route.captainPhone, existing?.captainPhone ?? ""),
      notes: keep(route.notes, existing?.notes ?? ""),
      active: route.active ?? existing?.active ?? true,
      sortOrder: route.sortOrder ?? existing?.sortOrder ?? index,
      stops,
    };
    if (!existing) {
      changes.push({
        code: route.code,
        id: null,
        input,
        lines: [`city ${input.city}, ${input.capacity} seats, captain ${input.captainName || "—"} ${input.captainPhone || ""}`.trim(), `stops: ${stopsText(stops)}`],
        before: null,
      });
      continue;
    }
    const lines: string[] = [];
    const compare = (label: string, before: unknown, after: unknown) => {
      if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) lines.push(`${label}: ${short(before ?? "")} -> ${short(after ?? "")}`);
    };
    compare("city", existing.city, input.city);
    compare("capacity", existing.capacity, input.capacity);
    compare("pickupPoint", existing.pickupPoint, input.pickupPoint);
    compare("departureAt", existing.departureAt?.toISOString() ?? null, input.departureAt?.toISOString() ?? null);
    compare("returnInfo", existing.returnInfo, input.returnInfo);
    compare("captainName", existing.captainName, input.captainName);
    compare("captainPhone", existing.captainPhone, input.captainPhone);
    compare("notes", existing.notes, input.notes);
    compare("active", existing.active, input.active);
    compare("sortOrder", existing.sortOrder, input.sortOrder);
    const before = stopsText(busTransport.routeStops(existing));
    const after = stopsText(stops);
    if (before !== after) lines.push(`stops: ${before}`, `    -> ${after}`);
    if (input.capacity < existing.seatsTaken) throw new CliError(`Bus ${route.code}: ${existing.seatsTaken} seats are booked; the plan's capacity ${input.capacity} is below that.`);
    if (lines.length === 0) untouched.push(route.code);
    else changes.push({ code: route.code, id: String(existing._id), input, lines, before: existing.toObject() });
  }
  const kept = stored.filter((r) => !planned.some((p) => p.code === r.code)).map((r) => r.code);
  return { changes, untouched, kept };
}

function printRouteChanges(plan: { changes: RouteChange[]; untouched: string[]; kept: string[] }): void {
  for (const change of plan.changes) {
    console.log(`  Bus ${change.code}: ${change.id ? "update" : "create"}`);
    for (const line of change.lines) console.log(`      ${line}`);
  }
  if (plan.untouched.length) console.log(`  Buses unchanged: ${plan.untouched.join(", ")}`);
  if (plan.kept.length) console.log(`  Buses not in the plan (left as they are): ${plan.kept.join(", ")}`);
}

async function applyRouteChanges(orgId: string, eventId: string, changes: RouteChange[]): Promise<string[]> {
  const ids: string[] = [];
  for (const change of changes) {
    const route = change.id ? await busTransport.updateRoute(orgId, change.id, change.input) : await busTransport.createRoute(orgId, eventId, change.input);
    ids.push(String(route._id));
    console.log(`  ✓ bus ${route.code}`);
  }
  return ids;
}

async function setupUpdate(flags: Flags, plan: Plan, org: { id: string; name: string; slug: string }, dbName: string, dryRun: boolean): Promise<void> {
  console.log(`Database: ${dbName}   Organization: ${org.name} (${org.slug})   Mode: update an existing event`);
  for (const key of [...plan.organizationModules, ...Object.keys(plan.eventModules)]) {
    if (!getModuleDefinition(key)) throw new CliError(`Unknown module "${key}".`);
  }
  const group = (await listGroupsForOrg(org.id)).find((g) => g.name === plan.group.name);
  if (!group) throw new CliError(`No event group named "${plan.group.name}". Run without --update to create it.`);
  const eventName = String(plan.event.name ?? "");
  const event = (await listEventsForOrg(org.id)).find((e) => e.name === eventName && String(e.groupId) === String(group._id));
  if (!event) throw new CliError(`No event named "${eventName}" in that group. Run without --update to create it.`);
  const eventId = String(event._id);

  // Lists are referenced, never re-imported here.
  const lists = await listDataListsForOrg(org.id);
  const listIds = new Map<string, string>();
  for (const entry of plan.dataLists) {
    const list = lists.find((l) => l.name === entry.name);
    if (list) listIds.set(entry.ref, String(list._id));
  }

  const entitled = await resolveModules({ organizationId: org.id });
  const grants = plan.organizationModules.filter((key) => !entitled.isOn(key));

  const storedModules = plainObject((event.modules ?? {}) as ModuleMap);
  const moduleChanges: Array<{ key: string; enabled: boolean; config: Record<string, string>; before: unknown }> = [];
  for (const [key, state] of Object.entries(plan.eventModules)) {
    const current = storedModules[key];
    const config = mergedConfig(key, current?.config, state.config);
    const currentConfig = current ? cleanModuleConfig(key, current.config ?? {}) : null;
    if (current?.enabled === state.enabled && JSON.stringify(currentConfig) === JSON.stringify(config)) continue;
    moduleChanges.push({ key, enabled: state.enabled, config, before: current ?? null });
  }

  validateEmailTriggers(plan.emails);
  const only = new Set(flags.getAll("email"));
  const storedEmails = await eventEmails.listEventEmails(eventId);
  const emailChanges: Array<{ name: string; id: string | null; input: Record<string, unknown>; fields: string[]; before: unknown }> = [];
  for (const raw of plan.emails) {
    const name = String(raw.name ?? "");
    if (only.size > 0 && !only.has(name)) continue;
    const resolved = resolveRefs(raw, listIds) as Record<string, unknown>;
    const desired = emailComparable({ ...resolved, body: sanitizeRichText(String(resolved.body ?? "")) });
    // A system email is one per event: one made in the console under another name is the one to update.
    const existing = storedEmails.find((e) => e.name === name) ?? (eventEmails.isSystemEmailTrigger(raw.trigger) ? storedEmails.find((e) => e.trigger === raw.trigger) : undefined);
    if (!existing) {
      emailChanges.push({ name, id: null, input: resolved, fields: ["(new email)"], before: null });
      continue;
    }
    const current = emailComparable(existing.toObject() as unknown as Record<string, unknown>);
    const fields: string[] = EMAIL_FIELDS.filter((field) => JSON.stringify(current[field]) !== JSON.stringify(desired[field]));
    if (existing.name !== name) fields.unshift("name");
    if (fields.length > 0) emailChanges.push({ name, id: String(existing._id), input: { ...resolved, name }, fields: [...fields], before: existing.toObject() });
  }
  if (only.size > 0) for (const name of only) if (!plan.emails.some((e) => e.name === name)) throw new CliError(`The plan has no email named "${name}".`);
  const routePlan = await planBusRoutes(eventId, plan.busRoutes);

  console.log(`\nEvent "${event.name}" ${eventId} [${event.status}] — its own fields are left as they are.`);
  console.log("Changes:");
  console.log(`  Grant modules: ${grants.length ? grants.join(", ") : "(none)"}`);
  for (const change of moduleChanges) {
    const before = change.before as { enabled?: boolean; config?: Record<string, unknown> } | null;
    console.log(`  Event module ${change.key}: ${before ? (before.enabled ? "on" : "off") : "not set"} -> ${change.enabled ? "on" : "off"}`);
    const oldConfig = before ? cleanModuleConfig(change.key, before.config ?? {}) : {};
    for (const [field, value] of Object.entries(change.config)) {
      if ((oldConfig as Record<string, string>)[field] !== value) console.log(`      ${field}: ${short((oldConfig as Record<string, string>)[field] ?? "")} -> ${short(value)}`);
    }
  }
  for (const change of emailChanges) {
    console.log(`  Email "${change.name}": ${change.id ? `update ${change.fields.join(", ")}` : "create"}`);
    if (change.id && change.fields.includes("body")) {
      const before = String((change.before as { body?: string }).body ?? "");
      const after = sanitizeRichText(String(change.input.body ?? ""));
      let i = 0;
      while (i < before.length && before[i] === after[i]) i += 1;
      console.log(`      body changes at char ${i}: …${short(before.slice(Math.max(0, i - 40), i + 120))}`);
      console.log(`                         -> …${short(after.slice(Math.max(0, i - 40), i + 200))}`);
    }
  }
  printRouteChanges(routePlan);
  if (grants.length === 0 && moduleChanges.length === 0 && emailChanges.length === 0 && routePlan.changes.length === 0) {
    console.log("\nNothing to change — the event already matches the plan.");
    return;
  }
  if (dryRun) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply --prod-ack to update.");
    return;
  }
  await confirmPhrase("UPDATE", flags, "confirm", `Write the changes above to "${dbName}"`);

  const before = { organizationModules: entitled.enabledKeys(), eventModules: storedModules, emails: emailChanges.map((c) => c.before), busRoutes: routePlan.changes.map((c) => c.before) };
  const done: Record<string, unknown> = { grantedModules: [] as string[], eventModules: [] as string[], emails: [] as string[], busRoutes: [] as string[] };
  try {
    for (const key of grants) {
      await setOrganizationModule(org.id, key, { enabled: true }, null);
      (done.grantedModules as string[]).push(key);
    }
    for (const change of moduleChanges) {
      await setEventModule(org.id, eventId, change.key, { enabled: change.enabled, config: change.config }, null);
      (done.eventModules as string[]).push(change.key);
      console.log(`  ✓ module ${change.key}`);
    }
    for (const change of emailChanges) {
      const input = change.input as unknown as eventEmails.EventEmailInput;
      const email = change.id ? await eventEmails.updateEventEmail(org.id, change.id, input) : await eventEmails.createEventEmail(org.id, eventId, input);
      (done.emails as string[]).push(String(email._id));
      console.log(`  ✓ email "${email.name}"`);
    }
    (done.busRoutes as string[]).push(...(await applyRouteChanges(org.id, eventId, routePlan.changes)));
  } finally {
    const after = {
      ...done,
      eventModules: plainObject(((await listEventsForOrg(org.id)).find((e) => String(e._id) === eventId)?.modules ?? {}) as ModuleMap),
      emails: (await eventEmails.listEventEmails(eventId)).filter((e) => (done.emails as string[]).includes(String(e._id))).map((e) => e.toObject()),
    };
    const dir = writeRestorePoint({
      entity: "setup",
      action: "update",
      recordId: eventId,
      before,
      after,
      audit: {
        timestamp: new Date().toISOString(),
        operator: resolveOperator(flags),
        command: process.argv.slice(2),
        entity: "setup",
        action: "update",
        organizationId: org.id,
        recordId: eventId,
        changes: [
          ...grants.map((key) => ({ field: `org module ${key}`, before: false, after: true })),
          ...moduleChanges.map((c) => ({ field: `event module ${c.key}`, before: c.before, after: { enabled: c.enabled, config: c.config } })),
          ...emailChanges.map((c) => ({ field: `email ${c.name}`, before: c.fields, after: "updated" })),
          ...routePlan.changes.map((c) => ({ field: `bus ${c.code}`, before: c.before ? "existing" : null, after: c.id ? "updated" : "created" })),
        ],
        reversible: false,
        note: "before.json holds the event modules and the emails as they were; restore them from the console if needed.",
      },
    });
    console.log(`\nRestore point: ${dir}`);
  }
}

export async function runSetupCommand(action: string | undefined, argv: string[]): Promise<void> {
  const flags = parseArgs(argv);
  if (action === "apply") return setupApply(flags);
  throw new CliError(`Unknown setup action "${action ?? ""}". Use: setup apply --org <slug> --plan <file.json> [--replace-lists] [--hide-api-key] [--update [--email <name>]]`);
}
