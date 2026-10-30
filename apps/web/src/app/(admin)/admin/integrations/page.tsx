import { getSumUpSettings, listWebhooks } from "@tbook/services";
import { webhookEventTypes } from "@tbook/schemas";
import { Badge, Card, EmptyState, PageHeader, Table } from "@tbook/ui";
import { formatDateTime, requireAdminPage } from "@/lib/admin-page";
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
  const [webhooks, sumup] = await Promise.all([listWebhooks(organizationId), getSumUpSettings(organizationId)]);
  const webhookReachable = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().startsWith("https://");

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Send booking and check-in events to another system as they happen."
      />

      <SumUpCard {...sumup} webhookReachable={webhookReachable} />

      <Card title="Endpoints">
        <div className="tbook-card-body-flush">
          {webhooks.length === 0 ? (
            <EmptyState
              title="No endpoints yet"
              hint="Add one below to start receiving events."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>URL</th>
                  <th>Events</th>
                  <th>Enabled</th>
                  <th>Last delivery</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {webhooks.map((hook) => (
                  <tr key={hook.id}>
                    <td className="tbook-wrap">
                      <code>{hook.url}</code>
                      {hook.description ? <div className="tbook-faint">{hook.description}</div> : null}
                    </td>
                    <td className="tbook-wrap">
                      {hook.events.map((event) => (
                        <Badge key={event} tone="info">
                          {event}
                        </Badge>
                      ))}
                    </td>
                    <td>
                      <Badge tone={hook.enabled ? "success" : "neutral"}>{hook.enabled ? "yes" : "no"}</Badge>
                    </td>
                    <td className="tbook-faint">
                      {hook.lastDeliveredAt ? (
                        <>
                          {formatDateTime(hook.lastDeliveredAt)}
                          <div>
                            {hook.lastError ? (
                              <Badge tone="danger">{hook.lastError}</Badge>
                            ) : (
                              <Badge tone="success">HTTP {hook.lastStatus}</Badge>
                            )}
                          </div>
                        </>
                      ) : (
                        "never"
                      )}
                    </td>
                    <td>
                      <WebhookRowActions webhookId={hook.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </Card>

      <WebhookForm eventTypes={[...webhookEventTypes]} />

      <Card title="How deliveries are signed">
        <p className="tbook-muted">
          Each delivery is a <code>POST</code> with a JSON body and these headers:
          <code> X-TBook-Event</code>, <code> X-TBook-Delivery</code> and
          <code> X-TBook-Signature</code>. The signature is
          <code> sha256=&lt;hex HMAC-SHA256 of the raw body&gt;</code> using the endpoint&apos;s signing secret —
          the same scheme Stripe and GitHub use, so an existing verification snippet works unchanged.
          Compare it in constant time, and verify against the <em>raw</em> body before parsing it.
        </p>
        <p className="tbook-muted">
          Deliveries are best-effort and are not retried: a failing endpoint never blocks a booking from
          being paid or cancelled. Respond <code>2xx</code> quickly and do your own work asynchronously.
        </p>
      </Card>
    </>
  );
}
