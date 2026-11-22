import { Mail } from "lucide-react";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { LoginWaiting } from "../../login-waiting";

/** Shown right after requesting a magic link. Also catches the "approved on the other device" outcome for the email-switch flow. */
export const dynamic = "force-dynamic";

export default async function SignInWaitingPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) redirect("/auth/signin");

  return (
    <AuthShell
      icon={<Mail />}
      title="Check your email"
      description="We sent you a one-time sign-in link. Open it on this device, or on any other — this page continues automatically either way."
      below={<LoginWaiting token={token} title="Waiting for the link" description="This updates automatically once the link is opened." />}
    />
  );
}
