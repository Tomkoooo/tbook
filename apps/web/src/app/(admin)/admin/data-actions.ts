"use server";

import { revalidatePath } from "next/cache";
import { ActionError } from "@tbook/actions";
import {
  applyImportTarget,
  createImportSession,
  deleteDataListForOrg,
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
    if (input.eventId) revalidatePath(`/admin/events/${input.eventId}`);
    revalidatePath("/admin/bus");
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
