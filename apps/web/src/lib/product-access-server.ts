import { ActionError } from "@tbook/actions";
import { requireOrgPermission } from "./admin-auth";

/** product:write, or event:write for roles saved before products existed. */
export async function requireProductWrite() {
  try {
    return await requireOrgPermission("product:write");
  } catch (error) {
    if (!(error instanceof ActionError) || error.status !== 403) throw error;
    return requireOrgPermission("event:write");
  }
}

/** Maps an ActionError (or anything) to a JSON error response. */
export function jsonError(error: unknown): Response {
  if (error instanceof ActionError) {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  console.error("[product media]", error);
  return Response.json({ error: { code: "internal_error", message: "Something went wrong. Please try again." } }, { status: 500 });
}
