import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionError } from "@tbook/actions";
import { eventGroupRepository } from "@tbook/db";
import { EVENT_EMAILS, eventEmails } from "@tbook/modules";
import type { AttendeeFieldDef } from "@tbook/schemas";
import { extensions, getEventForOrg, listDataListsForOrg, resolveModules, resolveTicketAttendeeFieldSchema } from "@tbook/services";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { formatDateTime, requireAdminPage } from "@/lib/admin-page";
import { EmailForm, SendPanel } from "../email-controls";

export const dynamic = "force-dynamic";

const MODE_LABELS: Record<string, string> = { auto: "automatic", manual: "manual send", test: "test" };

export default async function EmailPage({ params, searchParams }: { params: Promise<{ emailId: string }>; searchParams: Promise<{ eventId?: string; status?: string }> }) {
  const { emailId } = await params;
  const { eventId: eventIdParam, status } = await searchParams;
  const { organizationId } = await requireAdminPage("email:send");
  const isNew = emailId === "new";

  const email = isNew
    ? null
    : await eventEmails.getEventEmailForOrg(organizationId, emailId).catch((error) => {
        if (error instanceof ActionError) return null;
        throw error;
      });
  if (!isNew && !email) notFound();
  const eventId = email ? String(email.eventId) : (eventIdParam ?? "");
  const event = await getEventForOrg(organizationId, eventId).catch(() => null);
  if (!event) notFound();

  const modules = await resolveModules({ organizationId, event });
  const group = event.groupId ? await eventGroupRepository.findById(String(event.groupId)) : null;
  const schema = resolveTicketAttendeeFieldSchema({
    registrationUnit: event.registrationUnit,
    groupSchema: group?.defaultAttendeeFieldSchema as AttendeeFieldDef[] | undefined,
    eventSchema: event.attendeeFieldSchema as AttendeeFieldDef[],
    mode: event.attendeeFieldSchemaMode,
  });
  const lists = await listDataListsForOrg(organizationId);
  const moduleGroups = extensions
    .attendeePlaceholderProviders()
    .filter((provider) => modules.isOn(provider.moduleKey))
    .map((provider) => ({ label: provider.moduleKey, items: provider.placeholders }));

  const log = email ? await eventEmails.listEmailDeliveries(organizationId, emailId, { status: status === "failed" ? "failed" : undefined, limit: 200 }) : null;

  return (
    <>
      <PageTitle
        title={email ? email.name : "New email"}
        description={event.name}
        back={{ href: `/admin/emails?eventId=${eventId}`, label: "Emails" }}
        actions={!modules.isOn(EVENT_EMAILS) ? <Badge variant="warning">module off for this event</Badge> : null}
      />
      <EmailForm
        eventId={eventId}
        emailId={email ? emailId : null}
        initial={{
          name: email?.name ?? "",
          subject: email?.subject ?? "",
          body: email?.body ?? "",
          trigger: email?.trigger ?? "manual",
          audience: email?.audience ?? "registered",
          listId: email?.listId ? String(email.listId) : "",
          listMatchFieldKey: email?.listMatchFieldKey ?? "",
          conditions: (email?.conditions?.rules ?? []).map((rule) => ({ fieldKey: rule.fieldKey, op: rule.op, value: rule.value ?? "" })),
          conditionLogic: email?.conditions?.logic ?? "and",
          attachTicket: email?.attachTicket ?? false,
          active: email?.active ?? true,
          sortOrder: email?.sortOrder ?? 0,
        }}
        fields={schema.map((field) => ({ key: field.key, label: field.label, choices: field.choices?.map((c) => ({ value: c.value, label: c.label })) ?? [] }))}
        lists={lists.map((list) => ({ id: String(list._id), name: list.name, hasEmail: Boolean(list.emailColumn), columns: list.columns.map((c) => ({ key: c.key, label: c.label })) }))}
        placeholders={{
          attendee: eventEmails.ATTENDEE_PLACEHOLDERS,
          list: eventEmails.LIST_PLACEHOLDERS,
          fields: eventEmails.fieldPlaceholders(schema),
          modules: moduleGroups,
        }}
      />

      {email ? (
        <>
          <SendPanel emailId={emailId} manual={email.trigger === "manual"} />
          <SectionCard
            flush
            title="Delivery log"
            description={log ? `${log.sent} sent · ${log.failed} failed. Each address gets an email once; failed ones are retried by the next Send.` : undefined}
            actions={
              <Button asChild variant="outline" size="sm">
                <Link href={status === "failed" ? `/admin/emails/${emailId}` : `/admin/emails/${emailId}?status=failed`}>{status === "failed" ? "Show all" : "Failed only"}</Link>
              </Button>
            }
          >
            {!log || log.rows.length === 0 ? (
              <EmptyState title={status === "failed" ? "No failed deliveries" : "Nothing sent yet"} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>How</TableHead>
                    <TableHead className="text-right">Attempts</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {log.rows.map((row, index) => (
                    <TableRow key={`${row.to}-${index}`}>
                      <TableCell>
                        {row.name || row.to}
                        {row.name ? <div className="text-muted-foreground text-xs">{row.to}</div> : null}
                      </TableCell>
                      <TableCell>
                        {row.status === "sent" ? <Badge variant="success">sent</Badge> : <Badge variant="danger">failed</Badge>}
                        {row.error ? <div className="text-destructive max-w-md text-xs break-words">{row.error}</div> : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{MODE_LABELS[row.mode] ?? row.mode}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.attempts}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDateTime(row.sentAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </>
      ) : null}
    </>
  );
}
