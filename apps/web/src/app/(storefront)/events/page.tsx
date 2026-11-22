import Link from "next/link";
import { LogIn, Globe } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";

/**
 * This site is the admin back end: public event pages live on each
 * organizer's own website (see docs/site-integration-guide.md). The route is
 * kept so old links land on an honest explanation instead of a 404.
 */
export default function EventsPage() {
  return (
    <AuthShell
      icon={<Globe />}
      title="Event pages are on the organizer's website"
      description="This site is the admin back end of tBook. The public event pages live on the organizer's own website — use the link from the event's website or your confirmation email."
    >
      <Button asChild className="w-full">
        <Link href="/auth/signin?callbackUrl=/">
          <LogIn /> Staff sign-in
        </Link>
      </Button>
    </AuthShell>
  );
}
