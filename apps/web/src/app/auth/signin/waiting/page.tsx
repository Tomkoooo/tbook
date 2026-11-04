import { Mail } from "lucide-react";
import { redirect } from "next/navigation";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginWaiting } from "../../login-waiting";

/** Shown right after requesting a magic link. Also catches the "approved on the other device" outcome for the email-switch flow. */
export const dynamic = "force-dynamic";

export default async function SignInWaitingPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) redirect("/auth/signin");

  return (
    <main className="bg-background flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="size-5" /> Check your email
          </CardTitle>
          <CardDescription>We sent you a one-time sign-in link. Open it on this device, or on any other — this page continues automatically either way.</CardDescription>
        </CardHeader>
      </Card>
      <LoginWaiting token={token} title="Waiting for the link" description="This updates automatically once the link is opened." />
    </main>
  );
}
