import Link from "next/link";
import { Mail, Plus } from "lucide-react";
import { EVENT_EMAILS, eventEmails } from "@tbook/modules";
import { listEventsForOrg, resolveModules } from "@tbook/services";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { formatDateTime, requireAdminPage } from "@/lib/admin-page";
import { EmailEventPicker } from "./email-controls";

export const dynamic = "force-dynamic";

const AUDIENCE_LABELS: Record<string, string> = {
  registered: "Registered guests",
  list_all: "Everyone on a list",
  list_unregistered: "List — not registered yet",
};

export default async function EmailsPage({ searchParams }: { searchParams: Promise<{ eventId?: string }> }) {
  const { eventId: requested } = await searchParams;
  const { organizationId } = await requireAdminPage("email:send");

  const events = [];
  for (const event of await listEventsForOrg(organizationId)) {
    if ((await resolveModules({ organizationId, event })).isOn(EVENT_EMAILS)) events.push(event);
  }
  const event = events.find((e) => String(e._id) === requested) ?? events[0] ?? null;
  if (!event) {
    return (
      <>
        <PageTitle title="Emails" />
        <SectionCard>
          <EmptyState icon={<Mail />} title="No event uses event emails" hint="Switch on “Event emails” in an event's Modules section." />
        </SectionCard>
      </>
    );
  }

  const eventId = String(event._id);
  const emails = await eventEmails.listEventEmails(eventId);
  const logs = await Promise.all(emails.map((email) => eventEmails.listEmailDeliveries(organizationId, String(email._id), { limit: 1 })));

  return (
    <>
      <PageTitle
        title="Emails"
        description="Automatic emails go out when someone registers. Manual ones go out when you press Send — there is no scheduler, so send each on its day."
        actions={
          <>
            {events.length > 1 ? <EmailEventPicker events={events.map((e) => ({ id: String(e._id), name: e.name }))} value={eventId} /> : null}
            <Button asChild>
              <Link href={`/admin/emails/new?eventId=${eventId}`}>
                <Plus /> New email
              </Link>
            </Button>
          </>
        }
      />
      <SectionCard title={event.name} flush>
        {emails.length === 0 ? (
          <EmptyState title="No emails yet" hint="Start with the registration confirmation (automatic) and the opening announcement (manual)." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>When</TableHead>
                <TableHead>To</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead>Last send</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {emails.map((email, index) => {
                const log = logs[index];
                return (
                  <TableRow key={String(email._id)}>
                    <TableCell>
                      <Link href={`/admin/emails/${String(email._id)}`} className="font-medium hover:underline">
                        {email.name}
                      </Link>
                      {!email.active ? (
                        <Badge variant="warning" className="ml-2">
                          off
                        </Badge>
                      ) : null}
                      <div className="text-muted-foreground truncate text-xs">{email.subject}</div>
                    </TableCell>
                    <TableCell>{email.trigger === "on_registration" ? <Badge variant="info">automatic</Badge> : <Badge variant="secondary">manual</Badge>}</TableCell>
                    <TableCell>
                      {AUDIENCE_LABELS[email.audience] ?? email.audience}
                      {email.conditions?.rules?.length ? <div className="text-muted-foreground text-xs">with conditions</div> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{log?.sent ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{log?.failed ? <span className="text-destructive">{log.failed}</span> : 0}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {email.trigger === "manual" ? (email.sendState?.startedAt ? `${email.sendState.status} · ${formatDateTime(email.sendState.startedAt)}` : "not sent yet") : "on each registration"}
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
