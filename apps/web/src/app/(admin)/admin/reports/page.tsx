import Link from "next/link";
import { ChartColumn, Download } from "lucide-react";
import { eventReport, listEventsForOrg } from "@tbook/services";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { NativeSelect } from "@/components/form-bits";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { Stat, StatGrid } from "@/components/stat";
import { requireAdminPage } from "@/lib/admin-page";

export const dynamic = "force-dynamic";

/** One count as a horizontal bar; the number is printed beside it, so the bar never carries meaning alone. */
function BarRow({ label, count, max, total }: { label: string; count: number; max: number; total: number }) {
  const share = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="grid grid-cols-[minmax(6rem,12rem)_1fr_5.5rem] items-center gap-3 text-sm" title={`${label}: ${count} (${share}%)`}>
      <span className="truncate">{label}</span>
      <meter className="h-3 w-full" min={0} max={Math.max(max, 1)} value={count} aria-label={`${label}: ${count}`} />
      <span className="text-right tabular-nums">
        {count} <span className="text-muted-foreground">{share}%</span>
      </span>
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ eventId?: string; field?: string; value?: string }> }) {
  const query = await searchParams;
  const { organizationId } = await requireAdminPage("booking:read");
  const events = await listEventsForOrg(organizationId);
  const event = events.find((e) => String(e._id) === query.eventId) ?? events[0] ?? null;
  if (!event) {
    return (
      <>
        <PageTitle title="Reports" />
        <SectionCard>
          <EmptyState icon={<ChartColumn />} title="No events yet" />
        </SectionCard>
      </>
    );
  }
  const eventId = String(event._id);
  const filter = query.field && query.value ? { fieldKey: query.field, value: query.value } : {};
  const report = await eventReport(organizationId, eventId, filter);
  const exportParams = new URLSearchParams({ eventId, ...(filter.fieldKey ? { field: filter.fieldKey, value: filter.value! } : {}) });
  const filterField = report.filterFields.find((f) => f.key === query.field);
  const dayMax = Math.max(0, ...report.perDay.map((d) => d.guests));

  return (
    <>
      <PageTitle
        title="Reports"
        description={report.eventName}
        actions={
          <Button asChild variant="outline">
            <Link href={`/admin/reports/export?${exportParams.toString()}`} prefetch={false}>
              <Download /> Registrations (xlsx)
            </Link>
          </Button>
        }
      />

      <form method="get" action="/admin/reports" className="flex flex-wrap items-end gap-2">
        <NativeSelect name="eventId" defaultValue={eventId} aria-label="Event" className="w-64">
          {events.map((e) => (
            <option key={String(e._id)} value={String(e._id)}>
              {e.name}
            </option>
          ))}
        </NativeSelect>
        {report.filterFields.length > 0 ? (
          <>
            <NativeSelect name="field" defaultValue={query.field ?? ""} aria-label="Filter by question" className="w-56">
              <option value="">All guests</option>
              {report.filterFields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect name="value" defaultValue={query.value ?? ""} aria-label="Answer" className="w-56">
              <option value="">Any answer</option>
              {(filterField ?? report.filterFields[0])!.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </>
        ) : null}
        <Button type="submit" variant="secondary">
          Apply
        </Button>
        {filter.fieldKey ? (
          <Button asChild variant="ghost">
            <Link href={`/admin/reports?eventId=${eventId}`}>Clear</Link>
          </Button>
        ) : null}
      </form>
      {filter.fieldKey ? (
        <p className="text-muted-foreground text-sm">
          Showing guests where <strong>{filterField?.label}</strong> is <strong>{filterField?.options.find((o) => o.value === filter.value)?.label ?? filter.value}</strong>.
        </p>
      ) : null}

      <StatGrid>
        <Stat label="Guests" value={report.guests} hint={report.capacity != null && !filter.fieldKey ? `of ${report.capacity} places` : undefined} />
        <Stat label="Registrations" value={report.registrations} hint="group registrations count once" />
        <Stat label="Checked in" value={report.checkedIn} hint={report.guests > 0 ? `${Math.round((report.checkedIn / report.guests) * 100)}%` : undefined} />
        <Stat label="Not arrived yet" value={report.guests - report.checkedIn} />
        <Stat label="Cancelled guests" value={report.cancelledGuests} />
        <Stat label="Places left" value={report.capacity == null ? "∞" : Math.max(report.capacity - report.guests, 0)} />
      </StatGrid>

      {report.tagCounts.length > 0 ? (
        <SectionCard title="Tags">
          <div className="flex flex-wrap gap-2">
            {report.tagCounts.map((t) => (
              <Badge key={t.tag} variant="secondary">
                {t.tag} · {t.count}
              </Badge>
            ))}
          </div>
        </SectionCard>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {report.breakdowns.map((breakdown) => {
          const max = Math.max(0, ...breakdown.rows.map((r) => r.count));
          return (
            <SectionCard key={breakdown.fieldKey} title={breakdown.label}>
              <div className="grid gap-1.5">
                {breakdown.rows.map((row) => (
                  <BarRow key={row.value || "—"} label={row.label} count={row.count} max={max} total={report.guests} />
                ))}
              </div>
            </SectionCard>
          );
        })}
      </div>

      <SectionCard title="Registrations per day">
        {report.perDay.length === 0 ? (
          <EmptyState title="No registrations yet" />
        ) : (
          <div className="grid gap-1.5">
            {report.perDay.map((day) => (
              <div key={day.day} className="grid grid-cols-[6.5rem_1fr_7rem] items-center gap-3 text-sm" title={`${day.day}: ${day.guests} (total ${day.cumulative})`}>
                <span className="tabular-nums">{day.day}</span>
                <meter className="h-3 w-full" min={0} max={Math.max(dayMax, 1)} value={day.guests} aria-label={`${day.day}: ${day.guests}`} />
                <span className="text-right tabular-nums">
                  {day.guests} <span className="text-muted-foreground">Σ {day.cumulative}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </>
  );
}
