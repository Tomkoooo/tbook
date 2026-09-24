import { ActionError } from "@tbook/actions";
import { NextResponse } from "next/server";

/**
 * The one place every route handler maps an action's outcome to HTTP. v1
 * and v2 route handlers both funnel through this (with different success
 * envelopes if needed) so error handling never has to be reimplemented
 * per-endpoint the way the legacy plugin's api/handlers.ts did.
 */
export async function runAction<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const data = await fn();
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof ActionError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message, details: error.details } },
        { status: error.status },
      );
    }
    console.error(error);
    return NextResponse.json({ error: { code: "internal_error", message: "Internal error" } }, { status: 500 });
  }
}
