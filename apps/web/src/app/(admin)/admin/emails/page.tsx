import Link from "next/link";
import { Mail, Plus } from "lucide-react";
import { EVENT_EMAILS, FREE_REGISTRATION, WAITLIST, eventEmails, systemEmailDefault } from "@tbook/modules";
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
  const allEmails = await eventEmails.listEventEmails(eventId);
  const emails = allEmails.filter((email) => !eventEmails.isSystemEmailTrigger(email.trigger));
  const logs = await Promise.all(emails.map((email) => eventEmails.listEmailDeliveries(organizationId, String(email._id), { limit: 1 })));

  // System emails: one row per message a module sends on its own, customised or not, so the list is complete.
  const modules = await resolveModules({ organizationId, event });
  const waitlistMode = modules.config<{ mode?: string }>(WAITLIST).mode === "auto" && modules.isOn(FREE_REGISTRATION) ? "auto" : "offer";
  const systemRows = await Promise.all(
    eventEmails.SYSTEM_EMAILS.filter((info) => modules.isOn(info.moduleKey)).map(async (info) => {
      const template = allEmails.find((email) => email.trigger === info.trigger) ?? null;
      const log = template ? await eventEmails.listEmailDeliveries(organizationId, String(template._id), { limit: 1 }) : null;
      const unused =
        (info.trigger === "waitlist_offer" && waitlistMode === "auto") || (info.trigger === "waitlist_registered" && waitlistMode === "offer")
          ? `Not sent in the current waitlist mode (${waitlistMode === "auto" ? "register automatically" : "offer"}).`
          : null;
      return { info, template, log, unused, fallback: template ? null : systemEmailDefault(info.trigger, modules) };
    }),
  );

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

      <SectionCard
        title="System emails"
        description="Sent by the modules on their own (waitlist, bus seats, cancellation) — not by Send. Until you customise one, the built-in text goes out. Switching a customised one off stops that message completely. The registration confirmation is the automatic email above; without one, tBook's default booking confirmation goes out."
        flush
      >
        {systemRows.length === 0 ? (
          <EmptyState title="No system emails" hint="Waitlist, Bus transport and Guest self-service send these. None of them is on for this event." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>When it is sent</TableHead>
                <TableHead>Text</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {systemRows.map(({ info, template, log, unused, fallback }) => (
                <TableRow key={info.trigger}>
                  <TableCell className="align-top">
                    {template ? (
                      <Link href={`/admin/emails/${String(template._id)}`} className="font-medium hover:underline">
                        {template.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{info.label}</span>
                    )}
                    <div className="text-muted-foreground text-xs">{template ? info.label : null}</div>
                    <div className="text-muted-foreground max-w-xs truncate text-xs">{template?.subject ?? fallback?.subject}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-md align-top text-xs whitespace-normal">
                    {info.when}
                    {unused ? <div className="text-warning mt-1">{unused}</div> : null}
                  </TableCell>
                  <TableCell className="align-top">
                    {template ? (
                      template.active ? (
                        <Badge variant="success">custom</Badge>
                      ) : (
                        <Badge variant="warning">off — not sent</Badge>
                      )
                    ) : fallback?.source === "module_settings" ? (
                      <Badge variant="secondary">module settings text</Badge>
                    ) : (
                      <Badge variant="secondary">built-in default</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right align-top tabular-nums">{log?.sent ?? "—"}</TableCell>
                  <TableCell className="text-right align-top tabular-nums">{log?.failed ? <span className="text-destructive">{log.failed}</span> : log ? 0 : "—"}</TableCell>
                  <TableCell className="text-right align-top">
                    <Button asChild variant="outline" size="sm">
                      <Link href={template ? `/admin/emails/${String(template._id)}` : `/admin/emails/new?eventId=${eventId}&trigger=${info.trigger}`}>
                        {template ? "Edit" : "Customise"}
                      </Link>
                    </Button>
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
