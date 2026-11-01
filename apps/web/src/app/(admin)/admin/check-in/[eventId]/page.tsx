import Link from "next/link";
import { eventDayKeys, todayDayKey } from "@tbook/domain";
import { voucherStatuses } from "@tbook/schemas";
import { listCheckInRosterForOrg } from "@tbook/services";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { FormField, NativeSelect } from "@/components/form-bits";
import { LinkPagination } from "@/components/link-pagination";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { Stat } from "@/components/stat";
import { VOUCHER_STATUS_TONES, toneFor } from "@/lib/status-tones";
import { formatDate, formatDateTime, requireAdminPage } from "@/lib/admin-page";
import { ScanPanel } from "./scan-panel";
import { RevertCheckInButton } from "./revert-check-in-button";

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
  const query = await searchParams;

  const statusRaw = one(query, "status");
  const status = statusRaw && (voucherStatuses as readonly string[]).includes(statusRaw)
    ? [statusRaw as (typeof voucherStatuses)[number]]
    : undefined;
  const search = one(query, "search");
  const page = Math.max(Number(one(query, "page") ?? 1) || 1, 1);

  const roster = await listCheckInRosterForOrg(organizationId, eventId, { status, search }, { page, pageSize: 50 });

  function hrefForPage(target: number): string {
    const next = new URLSearchParams();
    if (statusRaw) next.set("status", statusRaw);
    if (search) next.set("search", search);
    next.set("page", String(target));
    return `/admin/check-in/${eventId}?${next.toString()}`;
  }

  const progress = roster.checkedIn + roster.outstanding;
  const isDayPass = roster.event.kind === "day_pass";
  const days = isDayPass ? eventDayKeys(roster.event.startDate, roster.event.endDate) : [];

  return (
    <>
      <PageTitle
        back={{ href: "/admin/check-in", label: "Check-in" }}
        title={roster.event.name}
        description={`${formatDate(roster.event.startDate)} – ${formatDate(roster.event.endDate)}`}
      />

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Checked in" value={roster.checkedIn} hint={progress > 0 ? `of ${progress} admittable` : undefined} />
        <Stat label="Outstanding" value={roster.outstanding} />
        <Stat label="Entries issued" value={roster.total} />
      </div>

      {permissions.has("voucher:scan") ? <ScanPanel eventId={eventId} today={todayDayKey(new Date())} days={days} /> : null}

      <SectionCard title="Roster" flush>
        <form
          method="get"
          action={`/admin/check-in/${eventId}`}
          className="grid gap-4 border-b p-5 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
        >
          <FormField label="Search" htmlFor="search">
            <Input id="search" name="search" defaultValue={search ?? ""} placeholder="Attendee name, e.g. Kovács…" />
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
          <div className="flex gap-2">
            <Button type="submit">Apply</Button>
            <Button variant="ghost" asChild>
              <Link href={`/admin/check-in/${eventId}`}>Clear</Link>
            </Button>
          </div>
        </form>

        {roster.vouchers.length === 0 ? (
          <EmptyState title="No entries match" hint="Entries are issued automatically once a booking is paid." />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Attendee</TableHead>
                  {isDayPass ? <TableHead>Pass for</TableHead> : null}
                  <TableHead>Status</TableHead>
                  <TableHead>Checked in</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.vouchers.map((voucher) => {
                  const id = String(voucher._id);
                  return (
                    <TableRow key={id}>
                      <TableCell className="font-medium">{voucher.displayName}</TableCell>
                      {isDayPass ? <TableCell className="tabular-nums">{voucher.validDate ?? "—"}</TableCell> : null}
                      <TableCell>
                        <Badge variant={toneFor(VOUCHER_STATUS_TONES, voucher.status)}>{voucher.status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDateTime(voucher.checkedInAt)}</TableCell>
                      <TableCell>
                        {voucher.status === "checked_in" && permissions.has("voucher:manage") ? (
                          <RevertCheckInButton eventId={eventId} voucherId={id} />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <LinkPagination page={roster.page} pageCount={roster.pageCount} total={roster.total} hrefForPage={hrefForPage} />
          </>
        )}
      </SectionCard>
    </>
  );
}
