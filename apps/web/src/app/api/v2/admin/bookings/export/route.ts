import { streamBookingExportCsv } from "@tbook/services";
import { adminBookingExportQuerySchema } from "@tbook/schemas";
import { parseInput } from "@tbook/actions";
import { requireOrgPermission } from "@/lib/admin-auth";
import { runV2, searchParamsToObject } from "@/lib/v2/response";
import { ActionError } from "@tbook/actions";
import { NextResponse } from "next/server";

/**
 * v2 — CSV export of the current filter selection. Gated on booking:export
 * (a separate permission from booking:read, matching the legacy catalog —
 * a viewer can read the table without being able to walk out with the
 * customer list).
 *
 * Streams the generator straight into the response body rather than
 * buffering: an org's full booking history can be large, and the service
 * layer already yields row by row off a Mongo cursor.
 */
export async function GET(request: Request) {
  let organizationId: string;
  let filter: ReturnType<typeof parseInput<typeof adminBookingExportQuerySchema>>;
  try {
    ({ organizationId } = await requireOrgPermission("booking:export"));
    filter = parseInput(adminBookingExportQuerySchema, searchParamsToObject(request.url));
  } catch (error) {
    // Auth/validation failures must still answer with the JSON error
    // envelope, not a half-written CSV — so they're resolved before the
    // stream is opened.
    return runV2(async () => {
      throw error instanceof ActionError ? error : ActionError.validation("Invalid export request");
    });
  }

  const rows = streamBookingExportCsv(organizationId, filter);
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await rows.next();
      if (done) controller.close();
      else controller.enqueue(new TextEncoder().encode(value));
    },
    async cancel() {
      // Client hung up mid-download — let the service close its cursor.
      await rows.return(undefined);
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bookings-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
