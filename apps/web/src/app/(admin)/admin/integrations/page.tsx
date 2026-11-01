import { getInventoryApiKey, getOrganizationSettings, getSumUpSettings, listWebhooks } from "@tbook/services";
import { webhookEventTypes } from "@tbook/schemas";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { formatDateTime, requireAdminPage } from "@/lib/admin-page";
import { SettingsNav } from "../settings/settings-nav";
import { InventoryApiCard } from "./inventory-api-card";
import { SmtpCard, StripeCard, SzamlazzCard } from "./settings-cards";
import { SumUpCard } from "./sumup-card";
import { WebhookForm } from "./webhook-form";
import { WebhookRowActions } from "./webhook-row-actions";

/**
 * Integrations screen. Outbound webhooks are the generic extension point:
 * wiring tBook to a new system (Zapier/Make/n8n, a CRM, a Slack relay, a
 * custom service) is configuration here rather than a code change and a
 * deploy.
 */
export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const { organizationId } = await requireAdminPage("org:update");
  const [webhooks, sumup, settings, inventoryKey] = await Promise.all([
    listWebhooks(organizationId),
    getSumUpSettings(organizationId),
    getOrganizationSettings(organizationId),
    getInventoryApiKey(organizationId),
  ]);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  const webhookReachable = appUrl.startsWith("https://");

  return (
    <>
      <PageTitle title="Settings" description="Payments, invoicing, email and connections to other systems." />
      <SettingsNav active="integrations" />

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <StripeCard stripe={settings.stripe} webhookUrl={`${appUrl || "https://your-domain"}/api/webhooks/stripe`} />
        <SzamlazzCard szamlazz={settings.szamlazz} />
        <SmtpCard smtp={settings.smtp} />
        <SumUpCard {...sumup} webhookReachable={webhookReachable} />
      <InventoryApiCard
        configured={inventoryKey.configured}
        hint={inventoryKey.hint}
        apiBaseUrl={`${appUrl || "https://your-domain"}/api/v2/inventory`}
      />
      </div>

      <SectionCard
        title="Webhook endpoints"
        description="Send booking and check-in events to another system as they happen."
        flush
      >
        {webhooks.length === 0 ? (
          <EmptyState title="No endpoints yet" hint="Add one below to start receiving events." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>URL</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead>Last delivery</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {webhooks.map((hook) => (
                <TableRow key={hook.id}>
                  <TableCell className="min-w-56 whitespace-normal">
                    <code className="font-mono text-xs break-all">{hook.url}</code>
                    {hook.description ? <div className="text-muted-foreground text-xs">{hook.description}</div> : null}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="flex flex-wrap gap-1">
                      {hook.events.map((event) => (
                        <Badge key={event} variant="info" className="font-mono">
                          {event}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={hook.enabled ? "success" : "neutral"}>{hook.enabled ? "yes" : "no"}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {hook.lastDeliveredAt ? (
                      <div className="grid gap-1">
                        {formatDateTime(hook.lastDeliveredAt)}
                        {hook.lastError ? (
                          <Badge variant="danger">{hook.lastError}</Badge>
                        ) : (
                          <Badge variant="success">HTTP {hook.lastStatus}</Badge>
                        )}
                      </div>
                    ) : (
                      "never"
                    )}
                  </TableCell>
                  <TableCell>
                    <WebhookRowActions webhookId={hook.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <WebhookForm eventTypes={[...webhookEventTypes]} />

      <SectionCard title="How deliveries are signed">
        <div className="text-muted-foreground grid gap-3 text-sm leading-relaxed [&_code]:font-mono [&_code]:text-xs [&_code]:text-foreground">
          <p>
            Each delivery is a <code>POST</code> with a JSON body and these headers: <code>X-TBook-Event</code>,{" "}
            <code>X-TBook-Delivery</code> and <code>X-TBook-Signature</code>. The signature is{" "}
            <code>sha256=&lt;hex HMAC-SHA256 of the raw body&gt;</code> using the endpoint&apos;s signing secret — the
            same scheme Stripe and GitHub use, so an existing verification snippet works unchanged. Compare it in
            constant time, and verify against the <em>raw</em> body before parsing it.
          </p>
          <p>
            Deliveries are best-effort and are not retried: a failing endpoint never blocks a booking from being paid
            or cancelled. Respond <code>2xx</code> quickly and do your own work asynchronously.
          </p>
        </div>
      </SectionCard>
    </>
  );
}
