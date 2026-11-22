import { TICKET_SALES } from "@tbook/modules";
import { requireAdminPage } from "@/lib/admin-page";
import { requireEvent, requireEventModule } from "@/lib/require-module";
import { BookingsView } from "@/app/(admin)/admin/bookings/bookings-view";

/** The guests of one event: the shared booking list, preset to this event. */
export const dynamic = "force-dynamic";

export default async function EventBookingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId, permissions } = await requireAdminPage("booking:read");
  const { eventId } = await params;
  const event = await requireEvent(organizationId, eventId);
  const off = await requireEventModule(organizationId, event, TICKET_SALES, "Ticket selling");
  if (off) return off;
  return <BookingsView organizationId={organizationId} permissions={permissions} params={await searchParams} event={{ id: String(event._id), name: event.name }} />;
}
