import ExcelJS from "exceljs";
import { ActionError } from "@tbook/actions";
import { eventRepository, importSessionRepository, type IImportSession, type ImportSessionSheet } from "@tbook/db";
import { resolveModules } from "./module-registry";
import { createDataList, replaceDataListRows, type DataListImportResult } from "./data-list-service";
import type { DataListKeyNormalization } from "@tbook/schemas";

/**
 * Generic spreadsheet import: upload an .xlsx/.csv, pick a sheet, map its
 * columns to whatever an import target needs, apply. Targets are an
 * extension point — core ships "data list"; modules add their own (bus
 * routes, …) with `registerImportTarget`.
 */

const MAX_CELLS = 400_000;
const MAX_COLUMNS = 80;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// ---- Parsing -----------------------------------------------------------------

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value == null) return "";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("").trim();
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("result" in value && value.result != null) return String(value.result).trim();
    if ("hyperlink" in value && typeof value.hyperlink === "string") return value.hyperlink.replace(/^mailto:/, "").trim();
  }
  return String(cell.text ?? "").trim();
}

function trimSheet(name: string, matrix: string[][]): ImportSessionSheet | null {
  const rows = matrix.filter((row) => row.some((cell) => cell !== ""));
  if (rows.length === 0) return null;
  const width = Math.min(Math.max(...rows.map((row) => row.length)), MAX_COLUMNS);
  const padded = rows.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ""));
  const [header, ...body] = padded;
  // Unnamed or repeated headers get a stable fallback, so every column can be mapped.
  const seen = new Map<string, number>();
  const names = header!.map((raw, index) => {
    const base = raw.trim() || `Column ${index + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count > 1 ? `${base} (${count})` : base;
  });
  return { name, header: names, rows: body };
}

function detectDelimiter(firstLine: string): string {
  const counts = [";", ",", "\t"].map((d) => ({ d, n: firstLine.split(d).length }));
  return counts.sort((a, b) => b.n - a.n)[0]!.d;
}

/** Small RFC-4180-ish CSV parser (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(source.split(/\r?\n/, 1)[0] ?? "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

/** Parses an uploaded workbook into sheets of text cells (first non-empty row = header). */
export async function parseSpreadsheet(fileName: string, bytes: Buffer): Promise<ImportSessionSheet[]> {
  const lower = fileName.toLowerCase();
  let sheets: ImportSessionSheet[];
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    const sheet = trimSheet("CSV", parseCsv(bytes.toString("utf8")));
    sheets = sheet ? [sheet] : [];
  } else if (lower.endsWith(".xlsx")) {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
    } catch {
      throw ActionError.validation("This file couldn't be read as an Excel workbook (.xlsx).");
    }
    sheets = [];
    workbook.eachSheet((worksheet) => {
      const matrix: string[][] = [];
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        const cells: string[] = [];
        for (let col = 1; col <= Math.min(row.cellCount, MAX_COLUMNS); col += 1) cells.push(cellText(row.getCell(col)));
        matrix.push(cells);
      });
      const sheet = trimSheet(worksheet.name, matrix);
      if (sheet) sheets.push(sheet);
    });
  } else {
    throw ActionError.validation("Upload an Excel workbook (.xlsx) or a CSV file.");
  }
  if (sheets.length === 0) throw ActionError.validation("The file has no rows.");
  const cells = sheets.reduce((sum, sheet) => sum + sheet.rows.length * sheet.header.length, 0);
  if (cells > MAX_CELLS) throw ActionError.validation("The file is too large to import in one go. Split it or remove unused columns.");
  return sheets;
}

// ---- Sessions ------------------------------------------------------------------

export async function createImportSession(organizationId: string, userId: string | null, fileName: string, bytes: Buffer): Promise<IImportSession> {
  const sheets = await parseSpreadsheet(fileName, bytes);
  return importSessionRepository.create({
    organizationId: organizationId as never,
    createdByUserId: userId,
    fileName,
    sheets,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
}

export async function getImportSessionForOrg(organizationId: string, sessionId: string): Promise<IImportSession> {
  const session = await importSessionRepository.findById(sessionId);
  if (!session || String(session.organizationId) !== organizationId) throw ActionError.notFound("This upload has expired. Upload the file again.");
  return session;
}

export function sheetFromSession(session: IImportSession, sheetName: string): ImportSessionSheet {
  const sheet = (session.sheets as ImportSessionSheet[]).find((s) => s.name === sheetName) ?? (session.sheets as ImportSessionSheet[])[0];
  if (!sheet) throw ActionError.validation("This upload has no sheets.");
  return sheet;
}

/** Turns sheet rows into objects keyed by column header. */
export function sheetRecords(sheet: ImportSessionSheet): Array<Record<string, string>> {
  return sheet.rows.map((row) => Object.fromEntries(sheet.header.map((name, i) => [name, row[i] ?? ""])));
}

// ---- Targets -------------------------------------------------------------------

export interface ImportTargetField {
  key: string;
  label: string;
  required?: boolean;
  hint?: string;
}

export interface ImportApplyContext {
  organizationId: string;
  userId: string | null;
  /** Set when the target works on one event (chosen in the wizard). */
  eventId: string | null;
}

export interface ImportApplyResult {
  message: string;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/** A destination for spreadsheet rows with a fixed set of fields to map columns onto. */
export interface ImportTarget {
  key: string;
  label: string;
  description: string;
  /** Owning module, or null for core. A module target is offered only where its module is on. */
  moduleKey: string | null;
  /** Whether the admin must pick an event first. */
  needsEvent: boolean;
  fields: ImportTargetField[];
  /** Rows are { fieldKey: cell text }, already mapped. */
  apply(ctx: ImportApplyContext, rows: Array<Record<string, string>>): Promise<ImportApplyResult>;
}

const TARGETS_KEY = Symbol.for("tbook.importTargets");

function targets(): Map<string, ImportTarget> {
  const holder = globalThis as unknown as Record<symbol, Map<string, ImportTarget> | undefined>;
  if (!holder[TARGETS_KEY]) holder[TARGETS_KEY] = new Map();
  return holder[TARGETS_KEY]!;
}

export function registerImportTarget(target: ImportTarget): void {
  targets().set(target.key, target);
}

export function listImportTargets(): ImportTarget[] {
  return [...targets().values()];
}

export function getImportTarget(key: string): ImportTarget | undefined {
  return targets().get(key);
}

/** Maps sheet records onto a target's fields: mapping is { targetFieldKey: sheet column name }. */
export function mapRecords(records: Array<Record<string, string>>, mapping: Record<string, string>): Array<Record<string, string>> {
  return records.map((record) => Object.fromEntries(Object.entries(mapping).filter(([, column]) => column).map(([field, column]) => [field, record[column] ?? ""])));
}

export async function applyImportTarget(
  ctx: ImportApplyContext,
  targetKey: string,
  session: IImportSession,
  sheetName: string,
  mapping: Record<string, string>,
): Promise<ImportApplyResult> {
  const target = getImportTarget(targetKey);
  if (!target) throw ActionError.validation("Unknown import target.");
  if (target.needsEvent && !ctx.eventId) throw ActionError.validation("Pick the event to import into.");
  if (String(session.organizationId) !== ctx.organizationId) throw ActionError.notFound("Import not found");
  if (ctx.eventId) {
    const event = await eventRepository.findById(ctx.eventId);
    if (!event || String(event.organizationId) !== ctx.organizationId) throw ActionError.notFound("Event not found");
    if (target.moduleKey && !(await resolveModules({ organizationId: ctx.organizationId, event })).isOn(target.moduleKey)) {
      throw ActionError.validation(`Switch on the module for this event first (event page → Modules).`);
    }
  } else if (target.moduleKey && !(await resolveModules({ organizationId: ctx.organizationId })).isOn(target.moduleKey)) {
    throw ActionError.forbidden("This import isn't enabled for your organization.");
  }
  for (const field of target.fields) {
    if (field.required && !mapping[field.key]) throw ActionError.validation(`Choose a column for "${field.label}".`);
  }
  const sheet = sheetFromSession(session, sheetName);
  return target.apply(ctx, mapRecords(sheetRecords(sheet), mapping));
}

// ---- The core data-list import (its columns are chosen, not fixed) ---------------

/** Column header → a stable key usable in rules and templates ("E-mail cím" → "e_mail_cim"). */
export function columnKey(header: string): string {
  const key = header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return key || "column";
}

export interface DataListImportOptions {
  /** Replace the rows of this existing list instead of creating a new one. */
  listId?: string | null;
  name: string;
  description?: string;
  /** Sheet column names to keep. */
  columns: string[];
  keyColumn: string;
  keyNormalization?: DataListKeyNormalization;
  emailColumn?: string | null;
  nameColumn?: string | null;
}

export async function importSessionAsDataList(
  organizationId: string,
  session: IImportSession,
  sheetName: string,
  options: DataListImportOptions,
): Promise<DataListImportResult> {
  return sheetAsDataList(organizationId, sheetFromSession(session, sheetName), session.fileName, options);
}

/** What a sheet becomes as a data list: column keys and the mapped records (no writes). */
export function prepareSheetAsDataList(sheet: ImportSessionSheet, fileName: string, options: DataListImportOptions) {
  const keep = options.columns.filter((name) => sheet.header.includes(name));
  if (!keep.includes(options.keyColumn)) keep.unshift(options.keyColumn);
  const usedKeys = new Set<string>();
  const columns = keep.map((header) => {
    let key = columnKey(header);
    for (let n = 2; usedKeys.has(key); n += 1) key = `${columnKey(header)}_${n}`;
    usedKeys.add(key);
    return { key, label: header };
  });
  const keyFor = (header: string | null | undefined) => (header ? (columns.find((c) => c.label === header)?.key ?? null) : null);
  const records = sheetRecords(sheet).map((record) => Object.fromEntries(columns.map((column) => [column.key, record[column.label] ?? ""])));
  const input = {
    name: options.name,
    description: options.description,
    keyColumn: keyFor(options.keyColumn)!,
    keyNormalization: options.keyNormalization,
    emailColumn: keyFor(options.emailColumn),
    nameColumn: keyFor(options.nameColumn),
    columns,
    sourceFileName: fileName,
  };
  return { input, records };
}

/** Imports a parsed sheet as a new data list, or as the new rows of `options.listId`. */
export async function sheetAsDataList(
  organizationId: string,
  sheet: ImportSessionSheet,
  fileName: string,
  options: DataListImportOptions,
): Promise<DataListImportResult> {
  if (!sheet.header.includes(options.keyColumn)) throw ActionError.validation(`The sheet has no column "${options.keyColumn}".`);
  const { input, records } = prepareSheetAsDataList(sheet, fileName, options);
  return options.listId
    ? replaceDataListRows(organizationId, options.listId, input, records)
    : createDataList(organizationId, input, records);
}
