"use server";

import { revalidatePath } from "next/cache";
import { ActionError } from "@tbook/actions";
import {
  appendDataListRows,
  applyImportTarget,
  createImportSession,
  deleteDataListForOrg,
  deleteDataListRow,
  getDataListForOrg,
  parsePastedRows,
  getImportSessionForOrg,
  importSessionAsDataList,
} from "@tbook/services";
import { dataListKeyNormalizations, type DataListKeyNormalization } from "@tbook/schemas";
import { requireOrgPermission } from "@/lib/admin-auth";

/**
 * Data page: spreadsheet import wizard and data lists. Every step re-checks
 * list:manage; an import session is only reachable from its own org.
 */

export interface DataActionResult {
  ok: boolean;
  message?: string;
}

export interface UploadedSheet {
  name: string;
  header: string[];
  rowCount: number;
  preview: string[][];
}

export interface UploadResult extends DataActionResult {
  sessionId?: string;
  fileName?: string;
  sheets?: UploadedSheet[];
}

export interface ApplyResult extends DataActionResult {
  details?: string[];
  listId?: string;
}

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function fail(error: unknown, label: string): DataActionResult {
  if (error instanceof ActionError) return { ok: false, message: error.message };
  console.error(`[${label}]`, error);
  return { ok: false, message: "Something went wrong. Please try again." };
}

export async function uploadImportFileAction(formData: FormData): Promise<UploadResult> {
  try {
    const { organizationId, userId } = await requireOrgPermission("list:manage");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw ActionError.validation("Choose an .xlsx or .csv file.");
    if (file.size > MAX_UPLOAD_BYTES) throw ActionError.validation("The file is larger than 15 MB.");
    const session = await createImportSession(organizationId, userId, file.name, Buffer.from(await file.arrayBuffer()));
    return {
      ok: true,
      sessionId: String(session._id),
      fileName: session.fileName,
      sheets: session.sheets.map((sheet) => ({ name: sheet.name, header: sheet.header, rowCount: sheet.rows.length, preview: sheet.rows.slice(0, 5) })),
    };
  } catch (error) {
    return fail(error, "uploadImportFileAction");
  }
}

export interface DataListImportInput {
  sessionId: string;
  sheetName: string;
  listId: string | null;
  name: string;
  description: string;
  columns: string[];
  keyColumn: string;
  keyNormalization: string;
  emailColumn: string;
  nameColumn: string;
}

export async function importDataListAction(input: DataListImportInput): Promise<ApplyResult> {
  try {
    const { organizationId } = await requireOrgPermission("list:manage");
    if (!input.name.trim()) throw ActionError.validation("Give the list a name.");
    if (!input.keyColumn) throw ActionError.validation("Choose the column that identifies a row.");
    const keyNormalization = (dataListKeyNormalizations as readonly string[]).includes(input.keyNormalization)
      ? (input.keyNormalization as DataListKeyNormalization)
      : "trim_case";
    const session = await getImportSessionForOrg(organizationId, input.sessionId);
    const result = await importSessionAsDataList(organizationId, session, input.sheetName, {
      listId: input.listId,
      name: input.name.trim(),
      description: input.description.trim(),
      columns: input.columns,
      keyColumn: input.keyColumn,
      keyNormalization,
      emailColumn: input.emailColumn || null,
      nameColumn: input.nameColumn || null,
    });
    revalidatePath("/admin/data");
    const details: string[] = [];
    if (result.skippedEmpty) details.push(`${result.skippedEmpty} rows had no key and were skipped.`);
    if (result.duplicateKeys.length) {
      details.push(`${result.duplicateKeys.length} keys appeared more than once (the first row was kept): ${result.duplicateKeys.slice(0, 10).join(", ")}${result.duplicateKeys.length > 10 ? "…" : ""}`);
    }
    return { ok: true, message: `${result.imported} rows imported into “${result.list.name}”.`, details, listId: String(result.list._id) };
  } catch (error) {
    return fail(error, "importDataListAction");
  }
}

export async function applyImportTargetAction(input: {
  sessionId: string;
  sheetName: string;
  targetKey: string;
  eventId: string | null;
  mapping: Record<string, string>;
}): Promise<ApplyResult> {
  try {
    const { organizationId, userId } = await requireOrgPermission("list:manage");
    const session = await getImportSessionForOrg(organizationId, input.sessionId);
    const result = await applyImportTarget({ organizationId, userId, eventId: input.eventId || null }, input.targetKey, session, input.sheetName, input.mapping);
    if (input.eventId) revalidatePath(`/admin/events/${input.eventId}`, "layout");
    else revalidatePath("/admin/events/[eventId]", "layout");
    const details = [...(result.skipped ? [`${result.skipped} rows skipped (missing required values).`] : []), ...result.errors.slice(0, 20)];
    return { ok: result.errors.length === 0, message: result.message, details };
  } catch (error) {
    return fail(error, "applyImportTargetAction");
  }
}

export async function deleteDataListAction(listId: string): Promise<DataActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("list:manage");
    await deleteDataListForOrg(organizationId, listId);
    revalidatePath("/admin/data");
    return { ok: true, message: "List deleted." };
  } catch (error) {
    return fail(error, "deleteDataListAction");
  }
}

/** Adds rows to a list: one row from the form fields (`cell:<column key>`), or many pasted from a spreadsheet (`paste`). */
export async function appendDataListRowsAction(listId: string, formData: FormData): Promise<ApplyResult> {
  try {
    const { organizationId } = await requireOrgPermission("list:manage");
    const list = await getDataListForOrg(organizationId, listId);
    const paste = String(formData.get("paste") ?? "");
    const rows = paste.trim()
      ? parsePastedRows(paste, list.columns)
      : [Object.fromEntries(list.columns.map((column) => [column.key, String(formData.get(`cell:${column.key}`) ?? "")]))];
    const result = await appendDataListRows(organizationId, listId, rows, { update: formData.get("update") === "on" });
    revalidatePath("/admin/data");
    revalidatePath(`/admin/data/${listId}`);
    const parts = [`${result.added.length} row${result.added.length === 1 ? "" : "s"} added`];
    if (result.updated.length) parts.push(`${result.updated.length} updated`);
    const details: string[] = [];
    if (result.existing.length) details.push(`Already in the list, left unchanged: ${result.existing.slice(0, 20).join(", ")}${result.existing.length > 20 ? "…" : ""}. Tick “Update rows that already exist” to overwrite them.`);
    if (result.skippedEmpty) details.push(`${result.skippedEmpty} row${result.skippedEmpty === 1 ? "" : "s"} had no key and ${result.skippedEmpty === 1 ? "was" : "were"} skipped.`);
    if (result.duplicateKeys.length) details.push(`Repeated keys (first one kept): ${result.duplicateKeys.join(", ")}`);
    return { ok: result.added.length + result.updated.length > 0, message: `${parts.join(", ")}. The list now has ${result.rowCount} rows.`, details, listId };
  } catch (error) {
    return fail(error, "appendDataListRowsAction");
  }
}

export async function deleteDataListRowAction(listId: string, key: string): Promise<DataActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("list:manage");
    const rowCount = await deleteDataListRow(organizationId, listId, key);
    revalidatePath("/admin/data");
    revalidatePath(`/admin/data/${listId}`);
    return { ok: true, message: `Row removed. The list now has ${rowCount} rows.` };
  } catch (error) {
    return fail(error, "deleteDataListRowAction");
  }
}
