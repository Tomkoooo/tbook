import Link from "next/link";
import { Ticket } from "lucide-react";
import { getOrganizationSettings, listMerchSales, listProducts } from "@tbook/services";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import { Notice } from "@/components/notice";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { formatDateTime, formatMoney, requireAdminPage } from "@/lib/admin-page";
import { hasPermissionOrFallback } from "@/lib/permission-fallbacks";
import { MerchRegister } from "./merch-register";
import { RetryReceiptButton } from "./retry-receipt-button";

export const dynamic = "force-dynamic";

export default async function MerchPage() {
  const { organizationId, permissions } = await requireAdminPage();
  if (!hasPermissionOrFallback(permissions, "sale:create") && !hasPermissionOrFallback(permissions, "booking:manage")) {
    return (
      <>
        <PageTitle title="Point of sale" description="You don't have permission to sell." />
        <Notice tone="warning">Ask an organization admin for the sale:create permission.</Notice>
      </>
    );
  }
  const [products, recent, settings] = await Promise.all([
    listProducts(organizationId, { status: "active", channel: "pos" }),
    listMerchSales(organizationId, 10),
    getOrganizationSettings(organizationId),
  ]);

  return (
    <>
      <PageTitle
        title="Point of sale"
        description="Merch from the shared stock — the same stock the webshop sells."
        actions={
          <Button variant="outline" asChild>
            <Link href="/admin/sales">
              <Ticket /> Ticket sales
            </Link>
          </Button>
        }
      />
      <MerchRegister products={products} currency={settings.currency} />

      {recent.length > 0 ? (
        <SectionCard title="Recent merch sales" flush>
          <DataTable
            rows={recent}
            rowKey={(sale) => sale.id}
            mobileCards
            density="comfortable"
            caption="Recent merch sales"
            columns={[
              { key: "when", header: "When", className: "text-muted-foreground", cell: (sale) => formatDateTime(sale.createdAt) },
              {
                key: "items",
                header: "Items",
                className: "max-w-80 truncate",
                mobile: "title",
                cell: (sale) => sale.lines.map((l) => `${l.quantity}× ${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ""}`).join(", "),
              },
              { key: "total", header: "Total", align: "right", cell: (sale) => formatMoney(sale.totalGross, sale.currency) },
              {
                key: "paid",
                header: "Paid",
                className: "text-muted-foreground",
                cell: (sale) => (sale.paymentMethod === "card" ? `card${sale.paymentReference ? ` · ${sale.paymentReference}` : ""}` : "cash"),
              },
              {
                key: "receipt",
                header: "Receipt",
                cell: (sale) =>
                  sale.receipt.status === "issued" && sale.receipt.hasPdf ? (
                    <a className="text-primary text-sm hover:underline" href={`/admin/merch/${sale.id}/receipt`} target="_blank" rel="noopener">
                      {sale.receipt.number} · print
                    </a>
                  ) : (
                    <RetryReceiptButton saleId={sale.id} error={sale.receipt.error} />
                  ),
              },
            ]}
          />
        </SectionCard>
      ) : null}
    </>
  );
}
