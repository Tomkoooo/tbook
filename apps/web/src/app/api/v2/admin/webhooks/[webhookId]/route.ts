import { deleteWebhook } from "@tbook/services";
import { requireOrgPermission } from "@/lib/admin-auth";
import { runV2 } from "@/lib/v2/response";

/** v2 — remove an endpoint. Idempotent: removing an unknown id is not an error. */
export async function DELETE(_request: Request, context: { params: Promise<{ webhookId: string }> }) {
  return runV2(async () => {
    const { organizationId } = await requireOrgPermission("org:update");
    const { webhookId } = await context.params;

    await deleteWebhook(organizationId, webhookId);
    return { data: { id: webhookId, deleted: true } };
  });
}
