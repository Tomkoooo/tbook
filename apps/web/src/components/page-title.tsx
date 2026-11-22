import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/**
 * PageTitle — the page header: optional back link, h1, description, a
 * badge/status slot next to the title, and a right-aligned action slot that
 * wraps under the title on phones.
 *
 * Props:
 *   title        the h1
 *   description  one line under it
 *   status       badges/dots shown right of the title (e.g. a booking's status)
 *   actions      buttons, right-aligned; full width stack on phones
 *   back         { href, label }  explicit back link ("Bookings")
 *   breadcrumbs  [{ label, href? }, …]  the page's ancestors. When `back` is not
 *                given the back link points at the nearest ancestor that has an
 *                href. (The console header already prints the full trail, so
 *                the page itself only shows the one-step-up link.)
 *
 *   <PageTitle title="Booking #1042" status={<Badge variant="success">paid</Badge>}
 *     breadcrumbs={[{ label: "Bookings", href: "/admin/bookings" }]} actions={…} />
 */
export function PageTitle({
  title,
  description,
  status,
  actions,
  back,
  breadcrumbs,
}: {
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  breadcrumbs?: Array<{ label: string; href?: string }>;
}) {
  const parent = breadcrumbs ? [...breadcrumbs].reverse().find((crumb) => crumb.href) : undefined;
  const backLink = back ?? (parent?.href ? { href: parent.href, label: parent.label } : undefined);
  return (
    <header className="grid gap-1.5">
      {backLink ? (
        <Link
          href={backLink.href}
          className="text-muted-foreground hover:text-foreground -ml-1 inline-flex w-fit items-center gap-0.5 text-sm transition-colors"
        >
          <ChevronLeft className="size-4" /> {backLink.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-[22px] leading-7 font-semibold tracking-tight break-words">{title}</h1>
            {status ? <div className="flex flex-wrap items-center gap-1.5">{status}</div> : null}
          </div>
          {description ? <p className="text-muted-foreground mt-1 max-w-3xl text-sm">{description}</p> : null}
        </div>
        {actions ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
