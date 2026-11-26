import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { dataListRepository } from "@tbook/db";
import { normalizeListKey } from "@tbook/domain";
import { appendDataListRows, deleteDataListRow, getDataListForOrg, listDataListsForOrg } from "@tbook/services";
import { parseArgs, requireFlag, type Flags } from "../lib/args";
import { checkApplyGate, resolveOperator, writeRestorePoint } from "../lib/change";
import { connectDb, resolveOrganization } from "../lib/env";
import { CliError } from "../lib/errors";
import { table } from "../lib/format";
import { confirmPhrase } from "../lib/interact";

/**
 * Data lists (employee rosters, VIP name lists): list them, look at rows, add rows from a spreadsheet without
 * replacing the list, and remove a single row. Writes go through data-list-service like the admin console's
 * "Add rows" dialog; dry run by default, --apply --prod-ack writes and leaves a restore point.
 *
 *   data list    --org <org>
 *   data rows    --org <org> --list <id|name> [--q <key prefix>] [--limit 50]
 *   data append  --org <org> --list <id|name> --file <x.xlsx|x.csv|x.txt> [--sheet <name>]
 *                [--map <column key or label>=<sheet column: A | 1>]...  (default: list columns in sheet order)
 *                [--from-row <n>] (first data row, 1-based; default 1, a header row equal to the labels is skipped)
 *                [--update] (overwrite rows whose key is already in the list)
 *   data delete-row --org <org> --list <id|name> --key <key> --apply --prod-ack --confirm DELETE
 */

async function resolveList(orgId: string, ref: string) {
  const lists = await listDataListsForOrg(orgId);
  const hit = lists.find((list) => String(list._id) === ref) ?? lists.filter((list) => list.name.toLowerCase() === ref.toLowerCase())[0];
  if (!hit) throw new CliError(`No data list matches "${ref}". Lists: ${lists.map((list) => `"${list.name}" (${list._id})`).join(", ") || "(none)"}`);
  return getDataListForOrg(orgId, String(hit._id));
}

async function dataList(flags: Flags): Promise<void> {
  await connectDb(flags.get("uri"));
  const org = await resolveOrganization(requireFlag(flags, "org"));
  const lists = await listDataListsForOrg(org.id);
  console.log(`Organization: ${org.name} (${org.slug})`);
  console.log(
    table(
      lists.map((list) => ({
        id: String(list._id),
        name: list.name,
        rows: String(list.rowCount),
        key: `${list.keyColumn} (${list.keyNormalization})`,
        columns: list.columns.map((column) => column.label).join(" | "),
      })),
      ["id", "name", "rows", "key", "columns"],
    ),
  );
}

async function dataRows(flags: Flags): Promise<void> {
  await connectDb(flags.get("uri"));
  const org = await resolveOrganization(requireFlag(flags, "org"));
  const list = await resolveList(org.id, requireFlag(flags, "list"));
  const q = normalizeListKey(flags.get("q") ?? "", list.keyNormalization);
  const rows = await dataListRepository.listRows(String(list._id), { q: q || undefined, limit: Number(flags.get("limit") ?? 50) });
  console.log(`${list.name} — ${list.rowCount} rows, key ${list.keyColumn} (${list.keyNormalization})`);
  console.log(table(rows.map((row) => ({ key: row.key, ...(row.data as Record<string, string>) })), ["key", ...list.columns.map((column) => column.key)]));
}

/** Plain text of a spreadsheet cell (numbers, rich text, hyperlinks, formulas). */
function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value) return String(value.text);
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    return "";
  }
  return String(value);
}

function columnIndex(ref: string): number {
  if (/^\d+$/.test(ref)) return Number(ref);
  if (/^[A-Za-z]{1,2}$/.test(ref)) return ref.toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  throw new CliError(`--map expects a sheet column like A or 2, got "${ref}".`);
}

/** The sheet as rows of cell text (1-based columns kept in place). */
async function readSheet(file: string, sheetName: string | undefined): Promise<string[][]> {
  if (!fs.existsSync(file)) throw new CliError(`No such file: ${file}`);
  if (!/\.xlsx$/i.test(file)) {
    return fs.readFileSync(file, "utf8").split(/\r?\n/).map((line) => ["", ...(line.includes("\t") ? line.split("\t") : line.includes(";") ? line.split(";") : line.split(","))]);
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const names = workbook.worksheets.map((sheet) => sheet.name);
  const sheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
  if (!sheet) throw new CliError(`No sheet "${sheetName}" in ${path.basename(file)}. Sheets: ${names.join(", ")}`);
  if (!sheetName && names.length > 1) console.log(`(reading the first sheet "${sheet.name}" — sheets: ${names.join(", ")}; pick one with --sheet)`);
  const out: string[][] = [];
  for (let r = 1; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const cells: string[] = [""];
    for (let c = 1; c <= Math.max(sheet.columnCount, row.cellCount); c += 1) cells.push(cellText(row.getCell(c).value).replace(/\s+/g, " ").trim());
    out.push(cells);
  }
  return out;
}

async function dataAppend(flags: Flags): Promise<void> {
  await connectDb(flags.get("uri"));
  const org = await resolveOrganization(requireFlag(flags, "org"));
  const list = await resolveList(org.id, requireFlag(flags, "list"));
  const listId = String(list._id);
  const columns = list.columns.map((column) => ({ key: column.key, label: column.label }));

  // Which sheet column feeds which list column.
  const mapping = new Map<string, number>();
  for (const entry of flags.getAll("map")) {
    const at = entry.lastIndexOf("=");
    if (at < 1) throw new CliError(`--map expects <list column>=<sheet column>, got "${entry}".`);
    const name = entry.slice(0, at).trim();
    const column = columns.find((c) => c.key === name || c.label.toLowerCase() === name.toLowerCase());
    if (!column) throw new CliError(`"${name}" is not a column of "${list.name}". Columns: ${columns.map((c) => c.label).join(", ")}`);
    mapping.set(column.key, columnIndex(entry.slice(at + 1).trim()));
  }
  if (mapping.size === 0) columns.forEach((column, i) => mapping.set(column.key, i + 1));
  if (!mapping.has(list.keyColumn)) throw new CliError(`Map the key column "${list.keyColumn}" with --map.`);

  const sheet = await readSheet(requireFlag(flags, "file"), flags.get("sheet"));
  const fromRow = Math.max(1, Number(flags.get("from-row") ?? 1));
  const labels = columns.map((column) => column.label.toLowerCase());
  const rows = sheet
    .slice(fromRow - 1)
    .filter((cells) => cells.some((cell) => cell !== ""))
    .filter((cells) => !columns.every((column, i) => (cells[mapping.get(column.key) ?? -1] ?? "").toLowerCase() === labels[i]))
    .map((cells) => Object.fromEntries(columns.map((column) => [column.key, mapping.has(column.key) ? (cells[mapping.get(column.key)!] ?? "") : ""])));

  // The plan: compare normalised keys with the list (and within the sheet).
  const seen = new Set<string>();
  const plan = rows.map((row) => {
    const key = normalizeListKey(row[list.keyColumn], list.keyNormalization);
    const status = !key ? "no key" : seen.has(key) ? "repeated" : "";
    if (key) seen.add(key);
    return { key, row, status };
  });
  const keys = plan.filter((p) => !p.status).map((p) => p.key);
  const existing = await dataListRepository.findExistingKeys(listId, keys);
  const update = flags.bool("update");
  for (const p of plan) if (!p.status) p.status = existing.has(p.key) ? (update ? "update" : "already in list") : "ADD";

  console.log(`Organization: ${org.name} (${org.slug}) — list "${list.name}" (${list.rowCount} rows, key ${list.keyColumn}, ${list.keyNormalization})`);
  console.log(`Mapping: ${columns.map((c) => `${c.label}←${mapping.has(c.key) ? `col ${mapping.get(c.key)}` : "∅"}`).join(", ")}`);
  console.log(table(plan.map((p) => ({ status: p.status, key: p.key, ...p.row })), ["status", "key", ...columns.map((c) => c.key)]));
  const toAdd = plan.filter((p) => p.status === "ADD");
  const toUpdate = plan.filter((p) => p.status === "update");
  console.log(`\n${toAdd.length} to add, ${toUpdate.length} to update, ${plan.length - toAdd.length - toUpdate.length} skipped.`);
  if (toAdd.length + toUpdate.length === 0) return;
  if (checkApplyGate(flags) === "dry-run") {
    console.log("Dry run — nothing written. Re-run with --apply --prod-ack to write.");
    return;
  }

  const before = await Promise.all(toUpdate.map((p) => dataListRepository.findRow(listId, p.key)));
  const result = await appendDataListRows(org.id, listId, [...toAdd, ...toUpdate].map((p) => p.row), { update });
  const dir = writeRestorePoint({
    entity: "data",
    action: "append",
    recordId: listId,
    before: { list: list.name, updatedRows: before.filter(Boolean) },
    after: { added: result.added, updated: result.updated },
    audit: {
      timestamp: new Date().toISOString(),
      operator: resolveOperator(flags),
      command: process.argv.slice(2),
      entity: "data",
      action: "append",
      organizationId: org.id,
      recordId: listId,
      changes: [{ field: "rowCount", before: list.rowCount, after: result.rowCount }],
      reversible: false,
      note: "Undo: `data delete-row --key <key>` for each added key (after.json); before.json holds overwritten rows.",
    },
  });
  console.log(`Added ${result.added.length}, updated ${result.updated.length}. "${list.name}" now has ${result.rowCount} rows.`);
  console.log(`Restore point: ${dir}`);
}

async function dataDeleteRow(flags: Flags): Promise<void> {
  await connectDb(flags.get("uri"));
  const org = await resolveOrganization(requireFlag(flags, "org"));
  const list = await resolveList(org.id, requireFlag(flags, "list"));
  const key = normalizeListKey(requireFlag(flags, "key"), list.keyNormalization);
  const row = await dataListRepository.findRow(String(list._id), key);
  if (!row) throw new CliError(`No row with key "${key}" in "${list.name}".`);
  console.log(`Row to delete from "${list.name}": ${JSON.stringify(row.data)}`);
  if (checkApplyGate(flags) === "dry-run") {
    console.log("Dry run — nothing written. Re-run with --apply --prod-ack --confirm DELETE.");
    return;
  }
  await confirmPhrase("DELETE", flags, "confirm", "Delete this row");
  const rowCount = await deleteDataListRow(org.id, String(list._id), key);
  const dir = writeRestorePoint({
    entity: "data",
    action: "delete-row",
    recordId: String(list._id),
    before: row.toObject(),
    after: null,
    audit: {
      timestamp: new Date().toISOString(),
      operator: resolveOperator(flags),
      command: process.argv.slice(2),
      entity: "data",
      action: "delete-row",
      organizationId: org.id,
      recordId: String(list._id),
      changes: [{ field: `row ${key}`, before: row.data, after: null }],
      reversible: false,
    },
  });
  console.log(`Deleted. "${list.name}" now has ${rowCount} rows. Restore point: ${dir}`);
}

export async function runDataCommand(action: string | undefined, argv: string[]): Promise<void> {
  const flags = parseArgs(argv);
  switch (action) {
    case "list":
      return dataList(flags);
    case "rows":
      return dataRows(flags);
    case "append":
      return dataAppend(flags);
    case "delete-row":
      return dataDeleteRow(flags);
    default:
      throw new CliError(`Unknown data action "${action}". Use list | rows | append | delete-row.`);
  }
}

