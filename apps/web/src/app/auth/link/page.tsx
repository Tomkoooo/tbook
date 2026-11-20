import { ensureDbConnection, loginRequestRepository } from "@tbook/db";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ClaimButton } from "./claim-button";

/** Opened by the camera of the device that scans a "sign in another device" QR code. Nothing happens until the button is pressed. */
export const dynamic = "force-dynamic";

export default async function DeviceLinkPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) redirect("/auth/signin");
  await ensureDbConnection();
  const request = await loginRequestRepository.findByToken(token);
  const valid = !!request && request.purpose === "device-link" && request.status === "confirmed" && request.expiresAt.getTime() > Date.now();

  return (
    <main className="bg-background flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in on this device</CardTitle>
          <CardDescription>
            {valid
              ? `You will be signed in as ${request!.confirmedEmail}. Only continue if you scanned this code yourself.`
              : "This code has expired or was already used. Show a new one on the signed-in device."}
          </CardDescription>
        </CardHeader>
        {valid ? (
          <CardContent>
            <ClaimButton token={token} />
          </CardContent>
        ) : null}
      </Card>
    </main>
  );
}
