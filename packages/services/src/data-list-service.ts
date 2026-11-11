import { ActionError } from "@tbook/actions";
import { EventModel, dataListRepository, type IDataList } from "@tbook/db";
import { normalizeListKey, type DataListMembership } from "@tbook/domain";
import type { DataListColumn, DataListKeyNormalization } from "@tbook/schemas";

/**
 * Organization-owned data lists (an employee roster uploaded from Excel,
 * …). Rules check registration answers against them (`in_list`), and other
 * features read a row's columns by key. Every function is org-scoped: a
 * list id from another organization behaves as if it didn't exist.
 */

export interface DataListInput {
  name: string;
  description?: string;
  keyColumn: string;
  keyNormalization?: DataListKeyNormalization;
  emailColumn?: string | null;
  nameColumn?: string | null;
  columns: DataListColumn[];
  sourceFileName?: string;
}

export interface DataListImportResult {
  list: IDataList;
  imported: number;
  /** Rows dropped because their key was empty. */
  skippedEmpty: number;
  /** Keys that appeared more than once (the first row wins). */
  duplicateKeys: string[];
}

const MAX_ROWS = 50_000;

/** Dry-run numbers for a would-be import (no writes). */
export function previewDataListRows(rows: Array<Record<string, string>>, keyColumn: string, normalization: DataListKeyNormalization = "trim_case") {
  const prepared = prepareRows(rows, keyColumn, normalization);
  return { rows: prepared.rows.length, skippedEmpty: prepared.skippedEmpty, duplicateKeys: prepared.duplicateKeys };
}

function prepareRows(
  rows: Array<Record<string, string>>,
  keyColumn: string,
  normalization: DataListKeyNormalization,
): { rows: Array<{ key: string; data: Record<string, string> }>; skippedEmpty: number; duplicateKeys: string[] } {
  if (rows.length > MAX_ROWS) throw ActionError.validation(`A data list can hold at most ${MAX_ROWS.toLocaleString("en")} rows.`);
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const prepared: Array<{ key: string; data: Record<string, string> }> = [];
  let skippedEmpty = 0;
  for (const row of rows) {
    const key = normalizeListKey(row[keyColumn], normalization);
    if (!key) {
      skippedEmpty += 1;
      continue;
    }
    if (seen.has(key)) {
      duplicates.add(key);
      continue;
    }
    seen.add(key);
    prepared.push({ key, data: row });
  }
  return { rows: prepared, skippedEmpty, duplicateKeys: [...duplicates].slice(0, 50) };
}

function assertColumns(input: DataListInput): void {
  const keys = new Set(input.columns.map((column) => column.key));
  if (!keys.has(input.keyColumn)) throw ActionError.validation("Pick which column identifies a row.");
  if (input.emailColumn && !keys.has(input.emailColumn)) throw ActionError.validation("The email column isn't one of the imported columns.");
  if (input.nameColumn && !keys.has(input.nameColumn)) throw ActionError.validation("The name column isn't one of the imported columns.");
}

/** Creates a list from spreadsheet rows (column key → cell text). */
export async function createDataList(organizationId: string, input: DataListInput, rows: Array<Record<string, string>>): Promise<DataListImportResult> {
  assertColumns(input);
  const normalization = input.keyNormalization ?? "trim_case";
  const prepared = prepareRows(rows, input.keyColumn, normalization);
  const list = await dataListRepository.create({
    organizationId: organizationId as never,
    name: input.name.trim(),
    description: input.description?.trim() ?? "",
    keyColumn: input.keyColumn,
    keyNormalization: normalization,
    emailColumn: input.emailColumn ?? null,
    nameColumn: input.nameColumn ?? null,
    columns: input.columns,
    rowCount: 0,
    sourceFileName: input.sourceFileName ?? "",
  });
  const imported = await dataListRepository.replaceRows(organizationId, String(list._id), prepared.rows);
  const updated = (await dataListRepository.updateById(String(list._id), { rowCount: imported })) ?? list;
  return { list: updated, imported, skippedEmpty: prepared.skippedEmpty, duplicateKeys: prepared.duplicateKeys };
}

/** Replaces a list's rows and column setup with a new upload (same list id, so rules keep pointing at it). */
export async function replaceDataListRows(
  organizationId: string,
  listId: string,
  input: DataListInput,
  rows: Array<Record<string, string>>,
): Promise<DataListImportResult> {
  await getDataListForOrg(organizationId, listId);
  assertColumns(input);
  const normalization = input.keyNormalization ?? "trim_case";
  const prepared = prepareRows(rows, input.keyColumn, normalization);
  const imported = await dataListRepository.replaceRows(organizationId, listId, prepared.rows);
  const list = await dataListRepository.updateById(listId, {
    name: input.name.trim(),
    description: input.description?.trim() ?? "",
    keyColumn: input.keyColumn,
    keyNormalization: normalization,
    emailColumn: input.emailColumn ?? null,
    nameColumn: input.nameColumn ?? null,
    columns: input.columns,
    rowCount: imported,
    sourceFileName: input.sourceFileName ?? "",
  });
  return { list: list!, imported, skippedEmpty: prepared.skippedEmpty, duplicateKeys: prepared.duplicateKeys };
}

export async function getDataListForOrg(organizationId: string, listId: string): Promise<IDataList> {
  const list = await dataListRepository.findById(listId);
  if (!list || String(list.organizationId) !== organizationId) throw ActionError.notFound("Data list not found");
  return list;
}

export function listDataListsForOrg(organizationId: string): Promise<IDataList[]> {
  return dataListRepository.findByOrganizationId(organizationId);
}

export async function deleteDataListForOrg(organizationId: string, listId: string): Promise<void> {
  await getDataListForOrg(organizationId, listId);
  // A registration rule pointing at a deleted list would refuse everyone.
  const usedBy = await EventModel.find({ organizationId, "eligibilityFormRules.rules.value": listId }, { name: 1 }).lean().exec();
  if (usedBy.length > 0) {
    throw ActionError.validation(`This list is used by the registration rules of ${usedBy.map((e) => `“${e.name}”`).join(", ")}. Remove the rule first.`);
  }
  await dataListRepository.deleteById(listId);
}

/** Looks up one row by a raw (un-normalised) key. */
export async function findDataListRow(organizationId: string, listId: string, rawKey: string): Promise<Record<string, string> | null> {
  const list = await getDataListForOrg(organizationId, listId);
  const key = normalizeListKey(rawKey, list.keyNormalization);
  if (!key) return null;
  const row = await dataListRepository.findRow(listId, key);
  return row ? (row.data as Record<string, string>) : null;
}

/**
 * Loads exactly the membership an `in_list` rule set will ask about, so the
 * pure rule engine can answer from memory. Lists owned by another
 * organization answer "no" for every value.
 */
export async function loadDataListMembership(
  organizationId: string | null,
  lookups: Array<{ listId: string; value: string }>,
): Promise<DataListMembership> {
  const found = new Map<string, Set<string>>();
  const normalizations = new Map<string, DataListKeyNormalization>();
  const byList = new Map<string, string[]>();
  for (const lookup of lookups) {
    const values = byList.get(lookup.listId) ?? [];
    values.push(lookup.value);
    byList.set(lookup.listId, values);
  }
  for (const [listId, values] of byList) {
    const list = organizationId ? await dataListRepository.findById(listId) : null;
    if (!list || String(list.organizationId) !== organizationId) {
      found.set(listId, new Set());
      continue;
    }
    normalizations.set(listId, list.keyNormalization);
    const keys = [...new Set(values.map((value) => normalizeListKey(value, list.keyNormalization)).filter(Boolean))];
    found.set(listId, await dataListRepository.findExistingKeys(listId, keys));
  }
  return (listId, value) => {
    const keys = found.get(listId);
    if (!keys) return false;
    return keys.has(normalizeListKey(value, normalizations.get(listId) ?? "trim_case"));
  };
}
