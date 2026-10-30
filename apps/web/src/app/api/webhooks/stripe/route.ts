import { NextResponse } from "next/server";
import { ActionError } from "@tbook/actions";
import { ensureDbConnection } from "@tbook/db";
import { handleStripeWebhook } from "@tbook/services";

/**
 * tBook owns its Stripe webhook outright (fixes the legacy cross-plugin
 * coupling where payment finalization was triggered from the generic shop
 * plugin's webhook). Signature verification and dispatch live in
 * @tbook/services' handleStripeWebhook; this route only supplies the raw
 * body, which must not be parsed first or the signature will not match.
 */
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: { code: "missing_signature" } }, { status: 400 });
  }

  try {
    await ensureDbConnection();
    const result = await handleStripeWebhook(await request.text(), signature);
    return NextResponse.json({ received: true, handled: result.handled });
  } catch (error) {
    if (error instanceof ActionError && error.status < 500) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 400 });
    }
    // A 5xx makes Stripe retry, which is right for a transient database failure.
    console.error("[stripe webhook]", error);
    return NextResponse.json({ error: { code: "internal_error" } }, { status: 500 });
  }
}
