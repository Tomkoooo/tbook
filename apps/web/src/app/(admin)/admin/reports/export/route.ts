import { ActionError } from "@tbook/actions";
import { exportEventRegistrationsXlsx } from "@tbook/services";
import { requireOrgPermission } from "@/lib/admin-auth";

/** Every guest of an event (optionally filtered by one answer) as .xlsx, cancelled guests on a second sheet. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const { organizationId } = await requireOrgPermission("booking:read");
    const field = url.searchParams.get("field");
    const value = url.searchParams.get("value");
    const { fileName, buffer } = await exportEventRegistrationsXlsx(organizationId, url.searchParams.get("eventId") ?? "", field && value ? { fieldKey: field, value } : {});
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ActionError) return new Response(error.message, { status: error.status });
    console.error("[registrations export]", error);
    return new Response("Could not build the export.", { status: 500 });
  }
}
