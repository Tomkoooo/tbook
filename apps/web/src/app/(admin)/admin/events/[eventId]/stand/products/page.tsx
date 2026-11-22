import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { STAND_MODE } from "@tbook/modules";
import { requireAdminPage } from "@/lib/admin-page";
import { requireEvent, requireEventModule } from "@/lib/require-module";
import { ProductEditor, type StandProductDto } from "./product-editor";
import { StandTabs } from "../stand-tabs";
import { stand } from "../shared";

export const dynamic = "force-dynamic";

export default async function StandProductsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { organizationId } = await requireAdminPage("stand:manage");
  const event = await requireEvent(organizationId, eventId);
  const off = await requireEventModule(organizationId, event, STAND_MODE, "Stand mode");
  if (off) return off;
  const rows: StandProductDto[] = (await stand.listProducts(eventId)).map((p) => ({
    id: String(p._id),
    name: p.name,
    category: p.category,
    priceHuf: p.priceHuf,
    depositHuf: p.depositHuf,
    costHuf: p.costHuf ?? null,
    image: p.image,
    active: p.active,
  }));

  return (
    <>
      <PageTitle
        title="Termékek"
        description={event.name}
        actions={
          <ProductEditor eventId={eventId} product={null} />
        }
      />
      <StandTabs active="products" eventId={eventId} manage />
      <SectionCard flush>
        {rows.length === 0 ? (
          <EmptyState title="Még nincs termék" hint="Add meg az italokat és ételeket, árral, visszaváltási értékkel és (opcionálisan) beszerzési árral." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Termék</TableHead>
                <TableHead>Ár</TableHead>
                <TableHead>Visszaváltási érték</TableHead>
                <TableHead>Beszerzési ár</TableHead>
                <TableHead>Haszon / db</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    {p.name} {p.category === "food" ? <Badge variant="outline">étel</Badge> : null} {p.active ? null : <Badge variant="outline">inaktív</Badge>}
                  </TableCell>
                  <TableCell className="tabular-nums">{p.priceHuf.toLocaleString("hu-HU")} Ft</TableCell>
                  <TableCell className="tabular-nums">{p.depositHuf ? `${p.depositHuf} Ft` : "–"}</TableCell>
                  <TableCell className="tabular-nums">{p.costHuf === null ? "–" : `${p.costHuf.toLocaleString("hu-HU")} Ft`}</TableCell>
                  <TableCell className="tabular-nums">{p.costHuf === null ? "–" : `${(p.priceHuf - p.depositHuf - p.costHuf).toLocaleString("hu-HU")} Ft`}</TableCell>
                  <TableCell className="text-right">
                    <ProductEditor eventId={eventId} product={p} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </>
  );
}
