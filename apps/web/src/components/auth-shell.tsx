import type { ReactNode } from "react";
import { Ticket } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * AuthShell — the sign-in screens' frame: centred card on the page
 * background, with the tBook mark above it. No sidebar, no header.
 *
 *   <AuthShell title="Sign in to tBook" description="…" icon={<Mail />} below={<LoginWaiting … />}>
 *     <form>…</form>
 *   </AuthShell>
 *
 * Props:
 *   title, description  card heading
 *   icon                Lucide icon element, shown in a chip before the title
 *   children            card body (omit when the description says it all)
 *   below               extra content under the card (e.g. a polling status card)
 */
export function AuthShell({
  title,
  description,
  icon,
  children,
  below,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  below?: ReactNode;
}) {
  return (
    <main className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-4">
      <div className="flex items-center gap-2.5">
        <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg">
          <Ticket className="size-5" />
        </span>
        <span className="text-lg font-semibold tracking-tight">tBook</span>
      </div>
      <Card className="w-full max-w-sm shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl [&_svg]:size-5">
            {icon}
            {title}
          </CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        {children ? <CardContent>{children}</CardContent> : null}
      </Card>
      {below}
    </main>
  );
}
