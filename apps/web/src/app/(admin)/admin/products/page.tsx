import Link from "next/link";
import { redirect } from "next/navigation";
import { Package, Plus } from "lucide-react";
import { listProducts } from "@tbook/services";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { formatMoney, requireAdminPage } from "@/lib/admin-page";
import { canReadProducts, canWriteProducts } from "@/lib/product-access";

export const dynamic = "force-dynamic";

const STATUS_TONE = { active: "success", draft: "neutral", archived: "warning" } as const;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { organizationId, permissions } = await requireAdminPage();
  if (!canReadProducts(permissions)) redirect("/admin?error=missing-permission&permission=product:read");
  const { q, status } = await searchParams;
  const products = await listProducts(organizationId, {
    search: q,
    status: status === "archived" ? "archived" : ["active", "draft"],
  });

  return (
    <>
      <PageTitle
        title="Products"
        description="Merchandise and its stock — shared by the point of sale and the webshop."
        actions={
          canWriteProducts(permissions) ? (
            <Button asChild>
              <Link href="/admin/products/new">
                <Plus /> New product
              </Link>
            </Button>
          ) : null
        }
      />

      <form className="flex flex-wrap gap-2" method="get">
        <Input name="q" defaultValue={q ?? ""} placeholder="Search name, SKU or category…" className="max-w-sm" aria-label="Search products" />
        <Button type="submit" variant="outline">
          Search
        </Button>
        <Button variant="ghost" asChild>
          <Link href={status === "archived" ? "/admin/products" : "/admin/products?status=archived"}>
            {status === "archived" ? "Show current" : "Show archived"}
          </Link>
        </Button>
      </form>

      <SectionCard flush>
        {products.length === 0 ? (
          <EmptyState icon={<Package />} title="No products yet" hint="Add a product with its sizes and stock to sell it at the counter and in the webshop." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Variants</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead>Sold on</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => {
                const prices = product.variants.map((v) => v.priceGross);
                const min = Math.min(...prices);
                const max = Math.max(...prices);
                const low = product.variants.filter((v) => v.active && v.available === 0).length;
                return (
                  <TableRow key={product.id}>
                    <TableCell className="whitespace-normal">
                      <Link className="font-medium hover:underline" href={`/admin/products/${product.id}`}>
                        {product.name}
                      </Link>
                      {product.category ? <div className="text-muted-foreground text-xs">{product.category}</div> : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-64 truncate">
                      {product.variants.length === 1 && !product.variants[0]!.label
                        ? product.variants[0]!.sku
                        : product.variants.map((v) => v.label).join(", ")}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMoney(min, product.currency)}
                      {max !== min ? ` – ${formatMoney(max, product.currency)}` : ""}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={product.totalAvailable === 0 ? "text-danger font-medium" : undefined}>{product.totalAvailable}</span>
                      {low > 0 && product.totalAvailable > 0 ? <div className="text-warning text-xs">{low} sold out</div> : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {product.channels.map((channel) => (
                          <Badge key={channel} variant="outline">
                            {channel === "pos" ? "counter" : "webshop"}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_TONE[product.status]}>{product.status}</Badge>
                    </TableCell>
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
