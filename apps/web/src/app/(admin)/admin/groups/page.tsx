import Link from "next/link";
import { Plus } from "lucide-react";
import { listGroupsForOrg } from "@tbook/services";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageTitle } from "@/components/page-title";
import { requireAdminPage } from "@/lib/admin-page";

export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const { organizationId, permissions } = await requireAdminPage("group:read");
  const groups = await listGroupsForOrg(organizationId);

  return (
    <>
      <PageTitle
        title="Event groups"
        description="Brands or series that own events, hotels and a public API key."
        actions={
          permissions.has("group:write") ? (
            <Button asChild>
              <Link href="/admin/groups/new">
                <Plus /> New group
              </Link>
            </Button>
          ) : null
        }
      />
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>API key</TableHead>
              <TableHead>Public listing</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground h-24 text-center">
                  No groups yet.
                </TableCell>
              </TableRow>
            ) : (
              groups.map((group) => (
                <TableRow key={String(group._id)}>
                  <TableCell>
                    <Link className="font-medium hover:underline" href={`/admin/groups/${group._id}`}>
                      {group.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={group.status === "active" ? "default" : "secondary"}>{group.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs">{group.apiKeyHint}</code>
                  </TableCell>
                  <TableCell>{group.listOnTBookSite ? "Listed" : "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
