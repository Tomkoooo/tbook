import "@/lib/register-modules";
import { NextResponse } from "next/server";
import { ActionError } from "@tbook/actions";
import { ensureDbConnection } from "@tbook/db";
import { handleSumUpWebhook } from "@tbook/services";

/**
 * SumUp `solo.transaction.updated` receiver.
 *
 * SumUp's webhook is unsigned, so the body is deliberately ignored: the
 * unguessable per-checkout token in the URL only says *which sale* to look
 * at, and handleSumUpWebhook then asks SumUp's API (authenticated with the
 * org's own key) what actually happened. A forged request can therefore do
 * nothing worse than trigger a status lookup.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    await ensureDbConnection();
    await handleSumUpWebhook(token);
    return NextResponse.json({ received: true });
  } catch (error) {
    if (error instanceof ActionError && error.status === 404) {
      return NextResponse.json({ error: { code: "unknown_checkout" } }, { status: 404 });
    }
    // A 5xx asks SumUp to retry, which is what we want when the lookup failed transiently.
    console.error("[sumup webhook]", error);
    return NextResponse.json({ error: { code: "internal_error" } }, { status: 500 });
  }
}
