import { Mail, QrCode } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createQrLoginRequestAction } from "../login-request-actions";
import { LoginWaiting } from "../login-waiting";

/** QR sign-in: scan with a phone that's already signed in — no typing on this device. */
export const dynamic = "force-dynamic";

export default async function QrSignInPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const { callbackUrl } = await searchParams;
  const { token, qrDataUrl } = await createQrLoginRequestAction(callbackUrl || "/admin");

  return (
    <main className="bg-background flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <QrCode className="size-5" /> Sign in with your phone
          </CardTitle>
          <CardDescription>Scan this with a phone that&apos;s already signed in to tBook, then approve it there.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- server-generated data: URL, not a static asset */}
          <img src={qrDataUrl} alt="QR code to confirm sign-in on your phone" width={224} height={224} className="rounded-md border" />
          <Button variant="link" asChild>
            <Link href={`/auth/signin${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`}>
              <Mail /> Use email instead
            </Link>
          </Button>
        </CardContent>
      </Card>
      <LoginWaiting token={token} title="Waiting for approval" description="Approve the request on your phone — this page continues automatically." />
    </main>
  );
}
