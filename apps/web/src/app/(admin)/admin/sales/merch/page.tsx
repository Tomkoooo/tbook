import { getOrganizationSettings, listMerchSales, listProducts } from "@tbook/services";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { formatDateTime, formatMoney, requireAdminPage } from "@/lib/admin-page";
import { SalesTabs } from "../sales-tabs";
import { MerchRegister } from "./merch-register";
import { RetryReceiptButton } from "./retry-receipt-button";

export const dynamic = "force-dynamic";

export default async function MerchSalesPage() {
  const { organizationId, permissions } = await requireAdminPage();
  if (!permissions.has("sale:create") && !permissions.has("booking:manage")) {
    return <PageTitle title="Point of sale" description="You don't have permission to sell." />;
  }
  const [products, recent, settings] = await Promise.all([
    listProducts(organizationId, { status: "active", channel: "pos" }),
    listMerchSales(organizationId, 10),
    getOrganizationSettings(organizationId),
  ]);

  return (
    <>
      <PageTitle title="Point of sale" description="Merch from the shared stock — the same stock the webshop sells." />
      <SalesTabs active="merch" />
      <MerchRegister products={products} currency={settings.currency} />

      {recent.length > 0 ? (
        <SectionCard title="Recent merch sales" flush>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>Receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell className="text-muted-foreground">{formatDateTime(sale.createdAt)}</TableCell>
                  <TableCell className="max-w-80 truncate">
                    {sale.lines.map((l) => `${l.quantity}× ${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ""}`).join(", ")}
                  </TableCell>
                  <TableCell className="text-right">{formatMoney(sale.totalGross, sale.currency)}</TableCell>
                  <TableCell className="text-muted-foreground">{sale.paymentMethod === "card" ? `card${sale.paymentReference ? ` · ${sale.paymentReference}` : ""}` : "cash"}</TableCell>
                  <TableCell>
                    {sale.receipt.status === "issued" && sale.receipt.hasPdf ? (
                      <a className="text-primary text-sm hover:underline" href={`/admin/sales/merch/${sale.id}/receipt`} target="_blank" rel="noopener">
                        {sale.receipt.number} · print
                      </a>
                    ) : (
                      <RetryReceiptButton saleId={sale.id} error={sale.receipt.error} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      ) : null}
    </>
  );
}
