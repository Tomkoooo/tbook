import Link from "next/link";
import { Database, Upload } from "lucide-react";
import { listDataListsForOrg } from "@tbook/services";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { formatDateTime, requireAdminPage } from "@/lib/admin-page";
import { DeleteDataListButton } from "./data-list-controls";

export const dynamic = "force-dynamic";

const NORMALIZATION_LABELS: Record<string, string> = {
  trim_case: "text, case-insensitive",
  digits_only: "digits only",
  alnum: "letters and digits",
};

export default async function DataPage() {
  const { organizationId, permissions } = await requireAdminPage("list:manage");
  const lists = await listDataListsForOrg(organizationId);
  const canManage = permissions.has("list:manage");

  return (
    <>
      <PageTitle
        title="Data"
        description="Spreadsheets uploaded once and used everywhere: registration rules check answers against a list, emails go to a list's people."
        actions={
          <Button asChild>
            <Link href="/admin/data/import">
              <Upload /> Import a spreadsheet
            </Link>
          </Button>
        }
      />
      <SectionCard title="Data lists" flush>
        {lists.length === 0 ? (
          <EmptyState icon={<Database />} title="No data lists yet" hint="Import an .xlsx or .csv — e.g. an employee list to check employee IDs at registration." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>List</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead>Key column</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lists.map((list) => {
                const keyLabel = list.columns.find((column) => column.key === list.keyColumn)?.label ?? list.keyColumn;
                return (
                  <TableRow key={String(list._id)}>
                    <TableCell>
                      <Link href={`/admin/data/${String(list._id)}`} className="font-medium hover:underline">
                        {list.name}
                      </Link>
                      {list.description ? <div className="text-muted-foreground text-xs">{list.description}</div> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{list.rowCount}</TableCell>
                    <TableCell>
                      {keyLabel}
                      <div className="text-muted-foreground text-xs">{NORMALIZATION_LABELS[list.keyNormalization] ?? list.keyNormalization}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{list.sourceFileName || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime((list as unknown as { updatedAt?: Date }).updatedAt)}</TableCell>
                    <TableCell className="text-right">{canManage ? <DeleteDataListButton listId={String(list._id)} name={list.name} /> : null}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </>
  );
}
