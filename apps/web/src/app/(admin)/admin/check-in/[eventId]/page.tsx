import Link from "next/link";
import { eventDayKeys, todayDayKey } from "@tbook/domain";
import { voucherStatuses } from "@tbook/schemas";
import { listCheckInRosterForOrg, listEventTags } from "@tbook/services";
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
import { RosterCheckInButton } from "./roster-check-in-button";
import { LiveRefresh } from "./live-refresh";
import { Download } from "lucide-react";

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
  const tag = one(query, "tag") || undefined;
  const page = Math.max(Number(one(query, "page") ?? 1) || 1, 1);

  const roster = await listCheckInRosterForOrg(organizationId, eventId, { status, search, tag }, { page, pageSize: 50 });

  function hrefForPage(target: number): string {
    const next = new URLSearchParams();
    if (statusRaw) next.set("status", statusRaw);
    if (search) next.set("search", search);
    if (tag) next.set("tag", tag);
    next.set("page", String(target));
    return `/admin/check-in/${eventId}?${next.toString()}`;
  }

  const tags = await listEventTags(eventId);
  const progress = roster.checkedIn + roster.outstanding;
  const isDayPass = roster.event.kind === "day_pass";
  const days = isDayPass ? eventDayKeys(roster.event.startDate, roster.event.endDate) : [];

  return (
    <>
      <PageTitle
        back={{ href: "/admin/check-in", label: "Check-in" }}
        title={roster.event.name}
        description={`${formatDate(roster.event.startDate)} – ${formatDate(roster.event.endDate)}`}
        actions={
          <Button asChild variant="outline">
            <Link href={`/admin/check-in/${eventId}/export`} prefetch={false}>
              <Download /> Arrivals (xlsx)
            </Link>
          </Button>
        }
      />
      <LiveRefresh seconds={15} />

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
          className={`grid gap-4 border-b p-5 sm:items-end ${tags.length > 0 ? "sm:grid-cols-[1fr_12rem_10rem_auto]" : "sm:grid-cols-[1fr_12rem_auto]"}`}
        >
          <FormField label="Search" htmlFor="search">
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
                      <TableCell>
                        <span className="font-medium">{voucher.displayName}</span>
                        {voucher.registrationNumber ? <div className="text-muted-foreground font-mono text-xs">{voucher.registrationNumber}</div> : null}
                        {(voucher.tags?.length ?? 0) > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {voucher.tags.map((value) => (
                              <Badge key={value} variant="secondary">
                                {value}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </TableCell>
                      {isDayPass ? <TableCell className="tabular-nums">{voucher.validDate ?? "—"}</TableCell> : null}
                      <TableCell>
                        <Badge variant={toneFor(VOUCHER_STATUS_TONES, voucher.status)}>{voucher.status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDateTime(voucher.checkedInAt)}</TableCell>
                      <TableCell>
                        {voucher.status === "checked_in" && permissions.has("voucher:manage") ? (
                          <RevertCheckInButton eventId={eventId} voucherId={id} />
                        ) : null}
                        {voucher.status === "active" && permissions.has("voucher:scan") ? <RosterCheckInButton eventId={eventId} voucherId={id} /> : null}
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
