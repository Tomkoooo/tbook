import Link from "next/link";
import { ArrowRightLeft, LayoutDashboard, LogOut, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Top of the signed-in home: who and where you are (organization, account),
 * how to change organization, open the console, or sign out.
 */
export function HomeHeader({ organizationName, email, canSwitchOrg, showConsole = true }: { organizationName: string | null; email: string | null; canSwitchOrg: boolean; showConsole?: boolean }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
          <Ticket className="size-5" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-lg leading-6 font-semibold tracking-tight">{organizationName ?? "tBook"}</h1>
          {email ? <p className="text-muted-foreground truncate text-xs">{email}</p> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canSwitchOrg ? (
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/select-org">
              <ArrowRightLeft /> Switch organization
            </Link>
          </Button>
        ) : null}
        {showConsole ? (
          <Button size="sm" asChild>
            <Link href="/admin">
              <LayoutDashboard /> Open admin console
            </Link>
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" asChild>
          <Link href="/api/auth/signout">
            <LogOut /> Sign out
          </Link>
        </Button>
      </div>
    </header>
  );
}
