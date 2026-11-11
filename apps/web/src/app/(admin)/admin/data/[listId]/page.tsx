import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionError } from "@tbook/actions";
import { dataListRepository } from "@tbook/db";
import { normalizeListKey } from "@tbook/domain";
import { getDataListForOrg } from "@tbook/services";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { requireAdminPage } from "@/lib/admin-page";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function DataListPage({ params, searchParams }: { params: Promise<{ listId: string }>; searchParams: Promise<{ q?: string; page?: string }> }) {
  const { listId } = await params;
  const { q = "", page = "1" } = await searchParams;
  const { organizationId } = await requireAdminPage("list:manage");
  const list = await getDataListForOrg(organizationId, listId).catch((error) => {
    if (error instanceof ActionError) return null;
    throw error;
  });
  if (!list) notFound();

  const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
  const search = normalizeListKey(q, list.keyNormalization);
  const rows = await dataListRepository.listRows(listId, { q: search || undefined, limit: PAGE_SIZE + 1, skip: (pageNumber - 1) * PAGE_SIZE });
  const hasNext = rows.length > PAGE_SIZE;
  const keyLabel = list.columns.find((column) => column.key === list.keyColumn)?.label ?? list.keyColumn;
  const pageHref = (n: number) => `/admin/data/${listId}?${new URLSearchParams({ ...(q ? { q } : {}), page: String(n) })}`;

  return (
    <>
      <PageTitle
        title={list.name}
        description={`${list.rowCount} rows · key: ${keyLabel}${list.sourceFileName ? ` · from ${list.sourceFileName}` : ""}`}
        back={{ href: "/admin/data", label: "Data" }}
        actions={
          <Button asChild variant="outline">
            <Link href={`/admin/data/import?replace=${listId}`}>Replace with a new file</Link>
          </Button>
        }
      />
      <SectionCard
        flush
        title="Rows"
        actions={
          <form className="flex gap-2">
            <Input name="q" defaultValue={q} placeholder={`Search by ${keyLabel}`} className="w-56" aria-label={`Search by ${keyLabel}`} />
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
        }
      >
        {rows.length === 0 ? (
          <EmptyState title={q ? "No row starts with that key" : "The list is empty"} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {list.columns.map((column) => (
                  <TableHead key={column.key}>{column.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, PAGE_SIZE).map((row) => {
                const data = row.data as Record<string, string>;
                return (
                  <TableRow key={String(row._id)}>
                    {list.columns.map((column) => (
                      <TableCell key={column.key} className={column.key === list.keyColumn ? "font-mono" : undefined}>
                        {data[column.key] ?? ""}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </SectionCard>
      {pageNumber > 1 || hasNext ? (
        <div className="flex justify-end gap-2">
          {pageNumber > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(pageNumber - 1)}>Previous</Link>
            </Button>
          ) : null}
          {hasNext ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(pageNumber + 1)}>Next</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
