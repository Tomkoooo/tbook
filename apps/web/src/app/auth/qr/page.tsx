import { Mail, QrCode } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth-shell";
import { createQrLoginRequestAction } from "../login-request-actions";
import { LoginWaiting } from "../login-waiting";

/** QR sign-in: scan with a phone that's already signed in — no typing on this device. */
export const dynamic = "force-dynamic";

export default async function QrSignInPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const { callbackUrl } = await searchParams;
  const { token, qrDataUrl } = await createQrLoginRequestAction(callbackUrl || "/admin");

  return (
    <AuthShell
      icon={<QrCode />}
      title="Sign in with your phone"
      description="Scan this with a phone that's already signed in to tBook, then approve it there."
      below={<LoginWaiting token={token} title="Waiting for approval" description="Approve the request on your phone — this page continues automatically." />}
    >
      <div className="flex flex-col items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- server-generated data: URL, not a static asset */}
        <img src={qrDataUrl} alt="QR code to confirm sign-in on your phone" width={224} height={224} className="rounded-md border bg-white p-2" />
        <Button variant="link" asChild>
          <Link href={`/auth/signin${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`}>
            <Mail /> Use email instead
          </Link>
        </Button>
      </div>
    </AuthShell>
  );
}
