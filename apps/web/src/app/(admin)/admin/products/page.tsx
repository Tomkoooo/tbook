import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Boxes, Package, PackageX, Plus, Search } from "lucide-react";
import { listProducts } from "@tbook/services";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SimpleTable } from "@/components/simple-table";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { FormField, NativeSelect } from "@/components/form-bits";
import { KpiGrid, KpiTile } from "@/components/kpi-tile";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { formatMoney, requireAdminPage } from "@/lib/admin-page";
import { canReadProducts, canWriteProducts } from "@/lib/product-access";
import { hrefWithParams, parseSort, sortRows } from "@/lib/table-sort";

export const dynamic = "force-dynamic";

const STATUS_TONE = { active: "success", draft: "neutral", archived: "warning" } as const;
const SORT_KEYS = ["name", "price", "available", "status"] as const;

type SearchParams = { q?: string; status?: string; sortBy?: string; sortDir?: string };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { organizationId, permissions } = await requireAdminPage();
  if (!canReadProducts(permissions)) redirect("/admin?error=missing-permission&permission=product:read");
  const params = await searchParams;
  const { q, status } = params;
  const archived = status === "archived";
  const products = await listProducts(organizationId, {
    search: q,
    status: archived ? "archived" : ["active", "draft"],
  });

  const sort = parseSort(params, SORT_KEYS, { key: "name", dir: "asc" });
  const minPrice = (product: (typeof products)[number]) => Math.min(...product.variants.map((v) => v.priceGross));
  const rows = sortRows(
    products,
    (product) => {
      switch (sort.key) {
        case "price":
          return minPrice(product);
        case "available":
          return product.totalAvailable;
        case "status":
          return product.status;
        default:
          return product.name;
      }
    },
    sort.dir,
  );

  const soldOut = products.filter((product) => product.totalAvailable === 0).length;
  const lowVariants = products.reduce(
    (sum, product) => sum + (product.totalAvailable > 0 ? product.variants.filter((v) => v.active && v.available === 0).length : 0),
    0,
  );
  const activeCount = products.filter((product) => product.status === "active").length;
  const hrefWith = (overrides: Record<string, string | undefined>) => hrefWithParams("/admin/products", params, overrides);
  const filtersApplied = Number(Boolean(q)) + Number(archived);

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

      <KpiGrid cols={4}>
        <KpiTile label={archived ? "Archived products" : "Products"} value={products.length} icon={<Package />} />
        <KpiTile label="On sale" value={activeCount} hint="status: active" tone="success" icon={<Boxes />} />
        <KpiTile label="Sold out" value={soldOut} hint="no stock in any size" tone={soldOut > 0 ? "danger" : "neutral"} icon={<PackageX />} />
        <KpiTile label="Sizes sold out" value={lowVariants} hint="in products still in stock" tone={lowVariants > 0 ? "warning" : "neutral"} icon={<AlertTriangle />} />
      </KpiGrid>

      <FilterBar action="/admin/products" clearHref="/admin/products" activeCount={filtersApplied} submitLabel="Search">
        <FormField label="Search" htmlFor="q" className="sm:col-span-2">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input id="q" name="q" defaultValue={q ?? ""} placeholder="Name, SKU or category…" className="pl-9" />
          </div>
        </FormField>
        <FormField label="Show" htmlFor="status">
          <NativeSelect id="status" name="status" defaultValue={archived ? "archived" : ""}>
            <option value="">Current (active + draft)</option>
            <option value="archived">Archived</option>
          </NativeSelect>
        </FormField>
      </FilterBar>

      <SectionCard flush>
        <SimpleTable
          rows={rows}
          rowKey={(product) => product.id}
          mobileCards
          caption="Products"
          sort={{
            state: sort,
            hrefFor: (key, dir) => hrefWith({ sortBy: key, sortDir: dir }),
          }}
          empty={
            <EmptyState
              icon={<Package />}
              title={q || archived ? "No products match" : "No products yet"}
              hint={
                q || archived
                  ? "Try a different search, or switch between current and archived products."
                  : "Add a product with its sizes and stock to sell it at the counter and in the webshop."
              }
              action={
                !q && !archived && canWriteProducts(permissions) ? (
                  <Button size="sm" asChild>
                    <Link href="/admin/products/new">
                      <Plus /> New product
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          }
          columns={[
            {
              key: "name",
              header: "Product",
              sortKey: "name",
              wrap: true,
              mobile: "title",
              cell: (product) => (
                <>
                  <Link className="font-medium hover:underline" href={`/admin/products/${product.id}`}>
                    {product.name}
                  </Link>
                  {product.category ? <div className="text-muted-foreground text-xs">{product.category}</div> : null}
                </>
              ),
            },
            {
              key: "variants",
              header: "Variants",
              className: "text-muted-foreground max-w-64 truncate",
              hideBelow: "lg",
              mobile: "hide",
              cell: (product) =>
                product.variants.length === 1 && !product.variants[0]!.label
                  ? product.variants[0]!.sku
                  : product.variants.map((v) => v.label).join(", "),
            },
            {
              key: "price",
              header: "Price",
              sortKey: "price",
              align: "right",
              cell: (product) => {
                const prices = product.variants.map((v) => v.priceGross);
                const min = Math.min(...prices);
                const max = Math.max(...prices);
                return (
                  <>
                    {formatMoney(min, product.currency)}
                    {max !== min ? ` – ${formatMoney(max, product.currency)}` : ""}
                  </>
                );
              },
            },
            {
              key: "available",
              header: "Available",
              sortKey: "available",
              align: "right",
              cell: (product) => {
                const low = product.variants.filter((v) => v.active && v.available === 0).length;
                return (
                  <>
                    <span className={product.totalAvailable === 0 ? "text-danger font-medium" : undefined}>{product.totalAvailable}</span>
                    {low > 0 && product.totalAvailable > 0 ? <div className="text-warning text-xs">{low} sold out</div> : null}
                  </>
                );
              },
            },
            {
              key: "channels",
              header: "Sold on",
              hideBelow: "md",
              cell: (product) => (
                <div className="flex gap-1">
                  {product.channels.map((channel) => (
                    <Badge key={channel} variant="outline">
                      {channel === "pos" ? "counter" : "webshop"}
                    </Badge>
                  ))}
                </div>
              ),
            },
            {
              key: "status",
              header: "Status",
              sortKey: "status",
              cell: (product) => <Badge variant={STATUS_TONE[product.status]}>{product.status}</Badge>,
            },
          ]}
        />
      </SectionCard>
    </>
  );
}
