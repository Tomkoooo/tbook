import { TICKET_SALES } from "@tbook/modules";
import { requireAdminPage } from "@/lib/admin-page";
import { requireModule } from "@/lib/require-module";
import { BookingsView } from "./bookings-view";

/** Every booking across the organization's events. One event's guests live at /admin/events/[eventId]/bookings. */
export const dynamic = "force-dynamic";

export default async function BookingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { organizationId, permissions } = await requireAdminPage("booking:read");
  const off = await requireModule(organizationId, TICKET_SALES, "Ticket selling");
  if (off) return off;
  return <BookingsView organizationId={organizationId} permissions={permissions} params={await searchParams} />;
}
