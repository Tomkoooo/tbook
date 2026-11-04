import { ensureDbConnection, loginRequestRepository } from "@tbook/db";
import { Mail, QrCode } from "lucide-react";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeDevice } from "../device-label";
import { sameDeviceCookieOptions } from "../same-device-cookie";

/** Email magic-link sign-in, plus a QR-code alternative. */
export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const { callbackUrl } = await searchParams;

  async function sendMagicLink(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    const destination = callbackUrl || "/admin";

    // Tracks which browser requested the link, so switch-device/page.tsx can
    // tell "opened on the same device" (skip the chooser) from "opened
    // somewhere else" (offer to sign in on this device instead).
    await ensureDbConnection();
    const userAgent = (await headers()).get("user-agent");
    const request = await loginRequestRepository.create({
      purpose: "email-switch",
      requesterLabel: describeDevice(userAgent),
      callbackUrl: destination,
    });
    (await cookies()).set(sameDeviceCookieOptions(request.token));

    await signIn("nodemailer", {
      email,
      redirect: false,
      redirectTo: `/auth/switch-device?token=${request.token}&next=${encodeURIComponent(destination)}`,
    });

    redirect(`/auth/signin/waiting?token=${request.token}`);
  }

  return (
    <main className="bg-background flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Sign in to tBook</CardTitle>
          <CardDescription>Enter your email and we&apos;ll send you a one-time sign-in link.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={sendMagicLink} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" name="email" placeholder="you@example.com" required autoFocus />
            </div>
            <Button type="submit" className="w-full">
              <Mail /> Send sign-in link
            </Button>
          </form>
          <div className="mt-4 text-center">
            <Button variant="link" asChild>
              <Link href={`/auth/qr${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`}>
                <QrCode /> Sign in with a QR code instead
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
