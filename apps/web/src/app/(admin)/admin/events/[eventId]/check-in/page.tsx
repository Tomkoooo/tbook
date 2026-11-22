import Link from "next/link";
import { eventDayKeys, todayDayKey } from "@tbook/domain";
import { TICKET_SALES } from "@tbook/modules";
import { voucherStatuses } from "@tbook/schemas";
import { listCheckInRosterForOrg, listEventTags } from "@tbook/services";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { FormField, NativeSelect } from "@/components/form-bits";
import { KpiGrid, KpiTile } from "@/components/kpi-tile";
import { LinkPagination } from "@/components/link-pagination";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { VOUCHER_STATUS_TONES, toneFor } from "@/lib/status-tones";
import { formatDate, formatDateTime, requireAdminPage } from "@/lib/admin-page";
import { eventPath, eventPathWith } from "@/lib/event-routes";
import { hasPermissionOrFallback } from "@/lib/permission-fallbacks";
import { requireEvent, requireEventModule } from "@/lib/require-module";
import { ScanPanel } from "./scan-panel";
import { RevertCheckInButton } from "./revert-check-in-button";
import { RosterCheckInButton } from "./roster-check-in-button";
import { LiveRefresh } from "./live-refresh";
import { DoorOpen, Download, Ticket, TicketCheck, UserX } from "lucide-react";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function one(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

export default async function CheckInEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { organizationId, permissions } = await requireAdminPage("voucher:read");
  const { eventId } = await params;
  const event = await requireEvent(organizationId, eventId);
  const off = await requireEventModule(organizationId, event, TICKET_SALES, "Ticket selling");
  if (off) return off;
  const query = await searchParams;

  const statusRaw = one(query, "status");
  const status = statusRaw && (voucherStatuses as readonly string[]).includes(statusRaw)
    ? [statusRaw as (typeof voucherStatuses)[number]]
    : undefined;
  const search = one(query, "search");
  const tag = one(query, "tag") || undefined;
  const page = Math.max(Number(one(query, "page") ?? 1) || 1, 1);

  const roster = await listCheckInRosterForOrg(organizationId, eventId, { status, search, tag }, { page, pageSize: 50 });

  function hrefForPage(target: number): string {
    return eventPathWith(eventId, "check-in", { status: statusRaw, search, tag, page: String(target) });
  }

  const tags = await listEventTags(eventId);
  const progress = roster.checkedIn + roster.outstanding;
  const isDayPass = roster.event.kind === "day_pass";
  const days = isDayPass ? eventDayKeys(roster.event.startDate, roster.event.endDate) : [];

  const activeFilters = [statusRaw, search, tag].filter(Boolean).length;

  return (
    <>
      <PageTitle
        title="Check-in"
        description={`${formatDate(roster.event.startDate)} – ${formatDate(roster.event.endDate)}`}
        actions={
          <Button asChild variant="outline">
            <Link href={eventPath(eventId, "check-in", "export")} prefetch={false}>
              <Download /> Arrivals (xlsx)
            </Link>
          </Button>
        }
      />
      <LiveRefresh seconds={15} />

      <KpiGrid cols={3}>
        <KpiTile
          label="Checked in"
          value={roster.checkedIn}
          hint={progress > 0 ? `of ${progress} admittable` : undefined}
          tone="success"
          icon={<TicketCheck />}
        />
        <KpiTile label="Outstanding" value={roster.outstanding} hint="still to arrive" tone={roster.outstanding > 0 ? "warning" : "neutral"} icon={<DoorOpen />} />
        <KpiTile label="Entries issued" value={roster.total} icon={<Ticket />} className="col-span-2 md:col-span-1" />
      </KpiGrid>

      {hasPermissionOrFallback(permissions, "voucher:scan") ? <ScanPanel eventId={eventId} today={todayDayKey(new Date())} days={days} /> : null}

      <FilterBar action={eventPath(eventId, "check-in")} clearHref={eventPath(eventId, "check-in")} activeCount={activeFilters}>
        <FormField label="Search" htmlFor="search" className="sm:col-span-2">
          <Input id="search" name="search" defaultValue={search ?? ""} placeholder="Name or registration number, e.g. Kovács or 7K3M-9QX2" />
        </FormField>
        <FormField label="Status" htmlFor="status">
          <NativeSelect id="status" name="status" defaultValue={statusRaw ?? ""}>
            <option value="">Any status</option>
            {voucherStatuses.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        {tags.length > 0 ? (
          <FormField label="Tag" htmlFor="tag">
            <NativeSelect id="tag" name="tag" defaultValue={tag ?? ""}>
              <option value="">Any tag</option>
              {tags.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        ) : null}
      </FilterBar>

      <SectionCard title="Roster" description="Auto-refreshes every 15 seconds." flush>
        <DataTable
          rows={roster.vouchers}
          rowKey={(voucher) => String(voucher._id)}
          mobileCards
          density="comfortable"
          caption="Roster"
          empty={
            <EmptyState
              icon={<UserX />}
              title="No entries match"
              hint="Entries are issued automatically once a booking is paid."
            />
          }
          columns={[
            {
              key: "attendee",
              header: "Attendee",
              mobile: "title",
              cell: (voucher) => (
                <>
                  <span className="font-medium">{voucher.displayName}</span>
                  {voucher.registrationNumber ? <div className="text-muted-foreground font-mono text-xs">{voucher.registrationNumber}</div> : null}
                  {(voucher.tags?.length ?? 0) > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {voucher.tags.map((value) => (
                        <Badge key={value} variant="note">
                          {value}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </>
              ),
            },
            ...(isDayPass
              ? [{ key: "validDate", header: "Pass for", cell: (voucher: (typeof roster.vouchers)[number]) => voucher.validDate ?? "—" }]
              : []),
            {
              key: "status",
              header: "Status",
              cell: (voucher) => <Badge variant={toneFor(VOUCHER_STATUS_TONES, voucher.status)}>{voucher.status}</Badge>,
            },
            {
              key: "checkedInAt",
              header: "Checked in",
              className: "text-muted-foreground",
              cell: (voucher) => formatDateTime(voucher.checkedInAt),
            },
            {
              key: "actions",
              header: <span className="sr-only">Actions</span>,
              align: "right",
              mobile: "footer",
              cell: (voucher) => {
                const id = String(voucher._id);
                return (
                  <>
                    {voucher.status === "checked_in" && hasPermissionOrFallback(permissions, "voucher:manage") ? (
                      <RevertCheckInButton eventId={eventId} voucherId={id} />
                    ) : null}
                    {voucher.status === "active" && hasPermissionOrFallback(permissions, "voucher:scan") ? <RosterCheckInButton eventId={eventId} voucherId={id} /> : null}
                  </>
                );
              },
            },
          ]}
        />
        {roster.vouchers.length > 0 ? (
          <LinkPagination page={roster.page} pageCount={roster.pageCount} total={roster.total} hrefForPage={hrefForPage} />
        ) : null}
      </SectionCard>
    </>
  );
}
