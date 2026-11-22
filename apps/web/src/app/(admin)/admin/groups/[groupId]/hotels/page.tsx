import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { HOTELS } from "@tbook/modules";
import { ActionError } from "@tbook/actions";
import { getGroupForOrg, listHotelsForOrg } from "@tbook/services";
import { normalizeHotelPricing } from "@tbook/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageTitle } from "@/components/page-title";
import { requireAdminPage } from "@/lib/admin-page";
import { groupPath } from "@/lib/event-routes";
import { hasPermissionOrFallback } from "@/lib/permission-fallbacks";
import { requireModule } from "@/lib/require-module";

export const dynamic = "force-dynamic";

export default async function HotelsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const { organizationId, permissions } = await requireAdminPage("hotel:read");
  const off = await requireModule(organizationId, HOTELS, "Hotels");
  if (off) return off;
  // The group comes from the path; another organization's (or an unknown) group is a 404.
  const group = await getGroupForOrg(organizationId, groupId).catch((error) => {
    if (error instanceof ActionError) return null;
    throw error;
  });
  if (!group) notFound();
  const hotels = (await listHotelsForOrg(organizationId)).filter((hotel) => String(hotel.groupId) === String(group._id));

  return (
    <>
      <PageTitle
        title="Hotels"
        description={`Accommodation for ${group.name}.`}
        back={{ href: groupPath(groupId), label: group.name }}
        actions={
          hasPermissionOrFallback(permissions, "hotel:write") ? (
            <Button asChild>
              <Link href={groupPath(groupId, "hotels", "new")}>
                <Plus /> New hotel
              </Link>
            </Button>
          ) : null
        }
      />
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Hotel</TableHead>
              <TableHead>Rooms / packages</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {hotels.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground h-24 text-center">
                  No hotels yet.
                </TableCell>
              </TableRow>
            ) : (
              hotels.map((hotel) => {
                const pricing = normalizeHotelPricing(hotel.pricing);
                return (
                  <TableRow key={String(hotel._id)}>
                    <TableCell>
                      <Link className="font-medium hover:underline" href={groupPath(groupId, "hotels", String(hotel._id))}>
                        {hotel.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {pricing.roomTypes?.length ?? 0} room types · {pricing.packages?.length ?? 0} packages
                    </TableCell>
                    <TableCell>
                      <Badge variant={hotel.status === "active" ? "default" : "secondary"}>{hotel.status}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
