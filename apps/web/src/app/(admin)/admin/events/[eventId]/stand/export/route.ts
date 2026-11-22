import { ActionError } from "@tbook/actions";
import { stand } from "@tbook/modules";
import { requireOrgPermission } from "@/lib/admin-auth";

/** Stand report (.xlsx) for a date range: summary, per product, per day. */
export async function GET(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const url = new URL(request.url);
  const { eventId } = await context.params;
  try {
    const { organizationId } = await requireOrgPermission("stand:manage");
    const { fileName, buffer } = await stand.exportStandXlsx(organizationId, eventId, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName.replace(/[^\w.-]+/g, "_")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ActionError) return new Response(error.message, { status: error.status });
    console.error("[stand export]", error);
    return new Response("Could not build the export.", { status: 500 });
  }
}
