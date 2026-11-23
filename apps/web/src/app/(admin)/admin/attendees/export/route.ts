import { ActionError } from "@tbook/actions";
import { listAttendeesForOrg, listBookingFilterOptions } from "@tbook/services";
import { requireOrgPermission } from "@/lib/admin-auth";
import { attendeeColumns } from "../../bookings/list-columns";
import { attendeeQueryFromParams } from "../../bookings/list-query";

/** The attendees list as CSV — the same filters as the page, every page of it, one column per registration question. */
const PAGE = 250;
const MAX_PAGES = 100;

function csv(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const { organizationId } = await requireOrgPermission("booking:export");
    const params: Record<string, string[]> = {};
    for (const [key, value] of url.searchParams) (params[key] ??= []).push(value);
    const eventId = url.searchParams.get("eventId") || undefined;

    const options = await listBookingFilterOptions(organizationId);
    const probe = await listAttendeesForOrg(organizationId, { eventId, pageSize: 1, withBreakdown: false });
    const columns = attendeeColumns({ eventPreset: Boolean(eventId), groups: options.groups, events: options.events, tags: options.tags, fields: probe.fields });
    const { filter } = attendeeQueryFromParams(params, columns as never, undefined, eventId);

    const header = ["Guest", "Reg. no.", "Event", ...probe.fields.map((field) => field.label), "Door", "Checked in at", "Tags", "Booked by"];
    const lines = [header.map(csv).join(",")];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result = await listAttendeesForOrg(organizationId, { ...filter, page, pageSize: PAGE, withBreakdown: false });
      for (const row of result.rows) {
        lines.push(
          [row.name, row.registrationNumber, row.eventName, ...probe.fields.map((field) => row.answers[field.key] ?? ""), row.status === "checked_in" ? "Checked in" : "Expected", row.checkedInAt ?? "", row.tags.join(", "), row.buyer]
            .map(csv)
            .join(","),
        );
      }
      if (page * PAGE >= result.total) break;
    }
    return new Response(String.fromCharCode(0xfeff) + lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="attendees.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ActionError) return new Response(error.message, { status: error.status });
    console.error("[attendees export]", error);
    return new Response("Could not build the export.", { status: 500 });
  }
}
