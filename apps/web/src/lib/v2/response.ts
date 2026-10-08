import { ActionError } from "@tbook/actions";
import { ensureDbConnection } from "@tbook/db";
import { NextResponse } from "next/server";

/**
 * v2's success envelope: every response is `{ data, meta }`, so a client
 * never has to special-case "is this the payload or an error?" the way the
 * legacy plugin's bare-object responses forced it to. Errors keep the same
 * `{ error: { code, message, details } }` shape v1 uses — one error model
 * across both versions (see @tbook/actions' ActionError).
 */

export interface V2Meta {
  [key: string]: unknown;
}

export async function runV2<T>(fn: () => Promise<{ data: T; meta?: V2Meta }>): Promise<NextResponse> {
  try {
    // Also the v2 surface's connection guard — see runV1's note.
    await ensureDbConnection();
    const { data, meta } = await fn();
    return NextResponse.json({ data, meta: meta ?? {} });
  } catch (error) {
    if (error instanceof ActionError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message, details: error.details } },
        { status: error.status },
      );
    }
    console.error("[v2]", error);
    return NextResponse.json({ error: { code: "internal_error", message: "Internal error" } }, { status: 500 });
  }
}

/** Turns a URL's search params into the plain object the Zod query schemas parse. */
export function searchParamsToObject(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

/** Parses a JSON body, reporting a malformed one as a 400 rather than a 500. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw ActionError.validation("Request body must be valid JSON");
  }
}

export interface PaginationMeta extends V2Meta {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}
