import { ActionError } from "@tbook/actions";
import { busTransport } from "@tbook/modules";
import { getEventForOrg } from "@tbook/services";
import { requireOrgPermission } from "@/lib/admin-auth";

/** Passenger lists as .xlsx: a summary sheet plus one sheet per bus and the bus waitlist (or a single bus with ?routeId). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const eventId = url.searchParams.get("eventId") ?? "";
  const routeId = url.searchParams.get("routeId");
  try {
    const { organizationId } = await requireOrgPermission("bus:manage");
    const event = await getEventForOrg(organizationId, eventId);
    const routes = (await busTransport.listRoutes(eventId)).filter((route) => !routeId || String(route._id) === routeId);
    // The whole-event export also lists the bus waitlist on its own sheet.
    const waitlist = routeId ? undefined : await busTransport.listBusWaitlist(String(event._id));
    const bytes = await busTransport.exportPassengersXlsx(routes, waitlist);
    const name = `${event.name}-buszok${routeId && routes[0] ? `-${routes[0].code}` : ""}`.replace(/[^\w.-]+/g, "_");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ActionError) return new Response(error.message, { status: error.status });
    console.error("[bus export]", error);
    return new Response("Could not build the export.", { status: 500 });
  }
}
