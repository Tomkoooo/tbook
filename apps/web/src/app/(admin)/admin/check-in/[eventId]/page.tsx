import Link from "next/link";
import { voucherStatuses } from "@tbook/schemas";
import { listCheckInRosterForOrg } from "@tbook/services";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Pagination,
  Select,
  Stat,
  StatRow,
  Table,
  VOUCHER_STATUS_TONES,
} from "@tbook/ui";
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

  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/admin/check-in">← Check-in</Link>}
        title={roster.event.name}
        description={`${formatDate(roster.event.startDate)} – ${formatDate(roster.event.endDate)}`}
      />

      <StatRow>
        <Stat label="Checked in" value={roster.checkedIn} hint={progress > 0 ? `of ${progress} admittable` : undefined} />
        <Stat label="Outstanding" value={roster.outstanding} />
        <Stat label="Entries issued" value={roster.total} />
      </StatRow>

      {permissions.has("voucher:scan") ? <ScanPanel eventId={eventId} /> : null}

      <Card title="Roster">
        <form method="get" action={`/admin/check-in/${eventId}`} className="tbook-filter-form">
          <Field label="Search" htmlFor="search" hint="Attendee name">
            <Input id="search" name="search" defaultValue={search ?? ""} placeholder="Kovács…" />
          </Field>
          <Field label="Status" htmlFor="status">
            <Select
              id="status"
              name="status"
              defaultValue={statusRaw ?? ""}
              placeholder="Any status"
              options={voucherStatuses.map((value) => ({ value, label: value }))}
            />
          </Field>
          <div className="tbook-filter-actions">
            <button type="submit" className="tbook-btn tbook-btn-primary">
              Apply
            </button>
            <Link href={`/admin/check-in/${eventId}`} className="tbook-btn tbook-btn-ghost">
              Clear
            </Link>
          </div>
        </form>
      </Card>

      <Card>
        <div className="tbook-card-body-flush">
          {roster.vouchers.length === 0 ? (
            <EmptyState
              title="No entries match"
              hint="Entries are issued automatically once a booking is paid."
            />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <th>Attendee</th>
                    <th>Status</th>
                    <th>Checked in</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {roster.vouchers.map((voucher) => {
                    const id = String(voucher._id);
                    return (
                      <tr key={id}>
                        <td>{voucher.displayName}</td>
                        <td>
                          <Badge tone={VOUCHER_STATUS_TONES[voucher.status] ?? "neutral"}>{voucher.status}</Badge>
                        </td>
                        <td className="tbook-faint">{formatDateTime(voucher.checkedInAt)}</td>
                        <td>
                          {voucher.status === "checked_in" && permissions.has("voucher:manage") ? (
                            <RevertCheckInButton eventId={eventId} voucherId={id} />
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              <Pagination page={roster.page} pageCount={roster.pageCount} total={roster.total} hrefForPage={hrefForPage} />
            </>
          )}
        </div>
      </Card>
    </>
  );
}
