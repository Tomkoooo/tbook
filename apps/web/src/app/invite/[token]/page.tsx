import Link from "next/link";
import { Building2 } from "lucide-react";
import { getInvitePreview, hashInviteToken } from "@tbook/services";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/notice";
import { getSessionUser } from "@/lib/admin-auth";
import { AcceptInviteForm } from "./accept-form";

/**
 * Invite landing page. Accepting is an explicit step (a button), never
 * automatic on page load, and only for the address the invite was sent to.
 */
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invite, user] = await Promise.all([getInvitePreview(hashInviteToken(token)), getSessionUser()]);
  const signInHref = `/auth/signin?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`;

  return (
    <main className="bg-background flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="bg-muted text-muted-foreground mb-2 flex size-10 items-center justify-center rounded-lg">
            <Building2 className="size-5" />
          </div>
          <CardTitle className="text-xl">
            {invite && !invite.expired ? `Join ${invite.organizationName}` : "Invitation"}
          </CardTitle>
          {invite && !invite.expired ? (
            <CardDescription>
              You&apos;ve been invited to work in <strong className="text-foreground">{invite.organizationName}</strong> on tBook.
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-4">
          {!invite ? (
            <Notice tone="danger">This invitation link isn&apos;t valid. Ask for a new invite.</Notice>
          ) : invite.expired ? (
            <Notice tone="warning">This invitation has expired or was already used. Ask for a new invite.</Notice>
          ) : !user ? (
            <>
              <p className="text-muted-foreground text-sm">
                Sign in with <strong className="text-foreground">{invite.email}</strong> to accept. If you don&apos;t have
                an account yet, signing in creates one.
              </p>
              <Button asChild>
                <Link href={signInHref}>Sign in to accept</Link>
              </Button>
            </>
          ) : user.email?.toLowerCase() !== invite.email ? (
            <>
              <Notice tone="warning">
                This invite is for <strong>{invite.email}</strong>, but you&apos;re signed in as <strong>{user.email}</strong>.
              </Notice>
              <Button variant="outline" asChild>
                <Link href="/api/auth/signout">Sign out and switch account</Link>
              </Button>
            </>
          ) : (
            <AcceptInviteForm token={token} />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
