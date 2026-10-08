import { listWebhooks, upsertWebhook } from "@tbook/services";
import { adminWebhookUpsertSchema } from "@tbook/schemas";
import { parseInput } from "@tbook/actions";
import { requireOrgPermission } from "@/lib/admin-auth";
import { readJsonBody, runV2 } from "@/lib/v2/response";

/**
 * v2 — outbound webhook endpoints. Gated on org:update: these are
 * organization configuration, not booking data, and an endpoint URL is an
 * egress destination for customer details.
 */
export async function GET() {
  return runV2(async () => {
    const { organizationId } = await requireOrgPermission("org:update");
    const webhooks = await listWebhooks(organizationId);

    return {
      // secretEnc is never serialized — the plaintext is returned once at
      // creation and is unrecoverable after that by design.
      data: webhooks.map(({ secretEnc: _secretEnc, ...rest }) => rest),
    };
  });
}

/** v2 — create or update an endpoint. Omit `id` to create. */
export async function POST(request: Request) {
  return runV2(async () => {
    const { organizationId } = await requireOrgPermission("org:update");
    const input = parseInput(adminWebhookUpsertSchema, await readJsonBody(request));

    const { webhook, secret } = await upsertWebhook({ organizationId, ...input });
    const { secretEnc: _secretEnc, ...rest } = webhook;

    // `secret` is present only on creation, and only in this one response.
    return { data: rest, meta: secret ? { secret } : {} };
  });
}
