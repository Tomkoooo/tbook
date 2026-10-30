import Link from "next/link";
import { Plus } from "lucide-react";
import { listGroupsForOrg, listHotelsForOrg } from "@tbook/services";
import { normalizeHotelPricing } from "@tbook/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageTitle } from "@/components/page-title";
import { requireAdminPage } from "@/lib/admin-page";

export const dynamic = "force-dynamic";

export default async function HotelsPage() {
  const { organizationId, permissions } = await requireAdminPage("hotel:read");
  const [hotels, groups] = await Promise.all([listHotelsForOrg(organizationId), listGroupsForOrg(organizationId)]);
  const groupName = new Map(groups.map((group) => [String(group._id), group.name]));

  return (
    <>
      <PageTitle
        title="Hotels"
        description="Accommodation guests can add to their booking."
        actions={
          permissions.has("hotel:write") ? (
            <Button asChild>
              <Link href="/admin/hotels/new">
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
              <TableHead>Group</TableHead>
              <TableHead>Rooms / packages</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {hotels.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground h-24 text-center">
                  No hotels yet.
                </TableCell>
              </TableRow>
            ) : (
              hotels.map((hotel) => {
                const pricing = normalizeHotelPricing(hotel.pricing);
                return (
                  <TableRow key={String(hotel._id)}>
                    <TableCell>
                      <Link className="font-medium hover:underline" href={`/admin/hotels/${hotel._id}`}>
                        {hotel.name}
                      </Link>
                    </TableCell>
                    <TableCell>{(hotel.groupId && groupName.get(String(hotel.groupId))) || "—"}</TableCell>
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
