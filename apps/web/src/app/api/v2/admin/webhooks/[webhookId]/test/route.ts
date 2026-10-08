import { sendTestWebhook } from "@tbook/services";
import { requireOrgPermission } from "@/lib/admin-auth";
import { runV2 } from "@/lib/v2/response";

/**
 * v2 — send a sample payload to one endpoint. Answers 200 with the
 * delivery outcome rather than mapping a failed delivery to an HTTP error:
 * the endpoint being down is information the caller asked for, not a fault
 * in this request.
 */
export async function POST(_request: Request, context: { params: Promise<{ webhookId: string }> }) {
  return runV2(async () => {
    const { organizationId } = await requireOrgPermission("org:update");
    const { webhookId } = await context.params;

    const outcome = await sendTestWebhook(organizationId, webhookId);
    return { data: outcome };
  });
}
