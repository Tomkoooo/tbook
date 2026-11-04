import { ensureDbConnection, loginRequestRepository } from "@tbook/db";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmButtons } from "../../confirm-buttons";

/** Opened by the phone's camera after scanning the QR code shown on the other device. */
export const dynamic = "force-dynamic";

export default async function QrConfirmPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) redirect("/auth/signin");

  const session = await auth();
  if (!session?.user) {
    redirect(`/auth/signin?callbackUrl=${encodeURIComponent(`/auth/qr/confirm?token=${token}`)}`);
  }

  await ensureDbConnection();
  const request = await loginRequestRepository.findByToken(token);
  const valid = !!request && request.status === "pending" && request.expiresAt.getTime() > Date.now();

  return (
    <main className="bg-background flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Confirm sign-in</CardTitle>
          <CardDescription>
            {valid
              ? `Allow sign-in on: ${request!.requesterLabel}?`
              : "This sign-in request is no longer valid. Go back to the other device and start again."}
          </CardDescription>
        </CardHeader>
        {valid && (
          <CardContent>
            <ConfirmButtons token={token} />
          </CardContent>
        )}
      </Card>
    </main>
  );
}
