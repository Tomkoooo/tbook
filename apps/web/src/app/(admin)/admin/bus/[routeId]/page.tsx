import { notFound, redirect } from "next/navigation";
import { ActionError } from "@tbook/actions";
import { busTransport } from "@tbook/modules";
import { requireAdminPage } from "@/lib/admin-page";
import { eventPath } from "@/lib/event-routes";

export const dynamic = "force-dynamic";

/** Old URL `/admin/bus/[routeId]`: a bus knows its event, so send the visitor to `/admin/events/[eventId]/bus/[routeId]`. */
export default async function LegacyBusRoutePage({ params }: { params: Promise<{ routeId: string }> }) {
  const { routeId } = await params;
  const { organizationId } = await requireAdminPage("bus:board");
  const route = await busTransport.getRouteForOrg(organizationId, routeId).catch((error) => {
    if (error instanceof ActionError) return null;
    throw error;
  });
  if (!route) notFound();
  redirect(eventPath(String(route.eventId), "bus", routeId));
}
