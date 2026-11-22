import { ensureDbConnection, loginRequestRepository } from "@tbook/db";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth-shell";
import { ConfirmButtons } from "../confirm-buttons";
import { safeRelativePath } from "@/lib/safe-redirect";
import { SAME_DEVICE_COOKIE } from "../same-device-cookie";

/**
 * Lands here right after a magic link finishes a normal, unmodified
 * NextAuth sign-in (see signin/page.tsx's redirectTo). If this browser is
 * the same one that requested the link (SAME_DEVICE_COOKIE matches), skip
 * straight to `next` — zero extra friction for the common case. Otherwise
 * offer to hand the session to the device that actually requested it.
 */
export const dynamic = "force-dynamic";

export default async function SwitchDevicePage({ searchParams }: { searchParams: Promise<{ token?: string; next?: string }> }) {
  const { token, next } = await searchParams;
  // `next` comes from the URL: only a same-site relative path may be followed.
  const destination = safeRelativePath(next, "/");
  if (!token) redirect(destination);

  const session = await auth();
  if (!session?.user) redirect(destination);

  await ensureDbConnection();
  const request = await loginRequestRepository.findByToken(token);
  if (!request || request.status !== "pending" || request.expiresAt.getTime() < Date.now()) {
    redirect(destination);
  }

  const sameDeviceToken = (await cookies()).get(SAME_DEVICE_COOKIE)?.value;
  if (sameDeviceToken === token) redirect(destination);

  return (
    <AuthShell
      title="Where do you want to sign in?"
      description={`This link was requested on: ${request.requesterLabel}. You're opening it from somewhere else.`}
    >
      <div className="grid gap-3">
        <Button asChild>
          <Link href={destination}>Sign in here</Link>
        </Button>
        <div className="text-muted-foreground text-center text-xs">or</div>
        <ConfirmButtons
          token={token}
          approveLabel="Sign in there instead"
          declineLabel="Cancel that request"
          approvedMessage={`Done — continue on ${request.requesterLabel}.`}
          declinedMessage="Cancelled. You can still sign in here."
        />
      </div>
    </AuthShell>
  );
}
