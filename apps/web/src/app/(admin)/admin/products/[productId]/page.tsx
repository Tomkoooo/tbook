import { notFound, redirect } from "next/navigation";
import { ActionError } from "@tbook/actions";
import { getOrganizationSettings, getProduct, listStockMovements } from "@tbook/services";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { formatDateTime, requireAdminPage } from "@/lib/admin-page";
import { canReadProducts, canWriteProducts } from "@/lib/product-access";
import { ProductForm } from "./product-form";
import { StockAdjustDialog } from "./stock-adjust-dialog";

export const dynamic = "force-dynamic";

const MOVEMENT_LABELS: Record<string, string> = {
  initial: "Starting stock",
  adjustment: "Adjustment",
  reservation: "Reserved (webshop)",
  reservation_release: "Reservation released",
  reservation_commit: "Sold (webshop)",
  sale: "Sold",
  return: "Returned",
};

export default async function ProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const { organizationId, permissions } = await requireAdminPage();
  if (!canReadProducts(permissions)) redirect("/admin?error=missing-permission&permission=product:read");
  const canEdit = canWriteProducts(permissions);

  if (productId === "new") {
    if (!canEdit) redirect("/admin/products");
    const { currency } = await getOrganizationSettings(organizationId);
    return (
      <>
        <PageTitle back={{ href: "/admin/products", label: "Products" }} title="New product" />
        <ProductForm product={null} canEdit currency={currency} />
      </>
    );
  }

  let product;
  try {
    product = await getProduct(organizationId, productId);
  } catch (error) {
    if (error instanceof ActionError && error.status === 404) notFound();
    throw error;
  }
  const movements = await listStockMovements(organizationId, { productId: product.id, limit: 30 });

  return (
    <>
      <PageTitle
        back={{ href: "/admin/products", label: "Products" }}
        title={product.name}
        description={`${product.totalAvailable} available across ${product.variants.length} variant${product.variants.length === 1 ? "" : "s"}`}
      />

      <SectionCard title="Stock" description="Counted stock per variant. Reserved units are held by open webshop checkouts." flush>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Variant</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Available</TableHead>
              <TableHead className="text-right">Reserved</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead>
                <span className="sr-only">Adjust</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {product.variants.map((variant) => (
              <TableRow key={variant.id} className={variant.active ? undefined : "opacity-60"}>
                <TableCell className="font-medium">
                  {variant.label || product.name}
                  {!variant.active ? <Badge variant="neutral" className="ml-2">off sale</Badge> : null}
                </TableCell>
                <TableCell className="font-mono text-xs">{variant.sku}</TableCell>
                <TableCell className={variant.available === 0 ? "text-danger text-right font-medium" : "text-right font-medium"}>{variant.available}</TableCell>
                <TableCell className="text-muted-foreground text-right">{variant.reserved}</TableCell>
                <TableCell className="text-right">{variant.onHand}</TableCell>
                <TableCell className="text-right">
                  {canEdit ? <StockAdjustDialog sku={variant.sku} label={variant.label || product.name} onHand={variant.onHand} reserved={variant.reserved} /> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>

      <ProductForm product={product} canEdit={canEdit} currency={product.currency} />

      <SectionCard title="Stock history" description="Last 30 changes to this product's stock, from every channel." flush>
        {movements.length === 0 ? (
          <EmptyState title="No stock changes yet" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>What</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((movement) => (
                <TableRow key={movement.id}>
                  <TableCell className="text-muted-foreground">{formatDateTime(movement.createdAt)}</TableCell>
                  <TableCell className="font-mono text-xs">{movement.sku}</TableCell>
                  <TableCell>
                    {MOVEMENT_LABELS[movement.type] ?? movement.type}
                    {movement.reason ? <div className="text-muted-foreground text-xs">{movement.reason}</div> : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {movement.onHandDelta > 0 ? `+${movement.onHandDelta}` : movement.onHandDelta || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-48 truncate font-mono text-xs">{movement.reference || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{movement.actor === "api" ? "webshop" : movement.actor === "pos" ? "counter" : movement.actor === "system" ? "auto" : "admin"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </>
  );
}
