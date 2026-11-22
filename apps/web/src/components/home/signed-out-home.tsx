import Link from "next/link";
import { Bus, LogIn, QrCode, ScanLine, Ticket } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";

const HELP = [
  { icon: Bus, who: "Bus captains and kiosk operators", what: "Open the link your organizer sent you. No sign-in needed." },
  { icon: Ticket, who: "Guests", what: "Use the event's own website or the confirmation email you received." },
  { icon: ScanLine, who: "Door, counter and stand staff", what: "Sign in with your email (Staff sign-in), or scan a QR code from a colleague's phone." },
] as const;

/** `/` for a visitor who isn't signed in: sign-in plus a "where do I go?" guide. No data is read. */
export function SignedOutHome() {
  return (
    <AuthShell title="tBook" description="Event booking, door check-in and counter sales for event teams.">
      <div className="grid gap-5">
        <Button size="lg" asChild>
          <Link href="/auth/signin?callbackUrl=/">
            <LogIn /> Staff sign-in
          </Link>
        </Button>

        <section aria-labelledby="where-do-i-go" className="grid gap-3">
          <h2 id="where-do-i-go" className="text-sm font-semibold">
            Where do I go?
          </h2>
          <ul className="grid gap-3">
            {HELP.map(({ icon: Icon, who, what }) => (
              <li key={who} className="flex items-start gap-3">
                <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
                  <Icon className="size-4" />
                </span>
                <p className="text-sm">
                  <span className="font-medium">{who}</span>
                  <span className="text-muted-foreground"> — {what}</span>
                </p>
              </li>
            ))}
          </ul>
        </section>

        <Button variant="link" asChild>
          <Link href="/auth/qr?callbackUrl=/">
            <QrCode /> Sign in with a QR code
          </Link>
        </Button>
      </div>
    </AuthShell>
  );
}
