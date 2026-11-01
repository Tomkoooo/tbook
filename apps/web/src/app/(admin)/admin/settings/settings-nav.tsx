import Link from "next/link";
import { Building2, FileText, Mail, Plug } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "general", href: "/admin/settings", label: "General", icon: Building2 },
  { key: "email", href: "/admin/settings/email", label: "Booking email", icon: Mail },
  { key: "voucher", href: "/admin/settings/voucher-pdf", label: "Ticket PDF", icon: FileText },
  { key: "integrations", href: "/admin/integrations", label: "Payments & integrations", icon: Plug },
] as const;

/** Tab bar shared by the organization settings pages (each tab is its own URL). */
export function SettingsNav({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="Settings sections" className="-mt-2 flex gap-1 overflow-x-auto border-b">
      {TABS.map(({ key, href, label, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          aria-current={active === key ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            active === key
              ? "border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground border-transparent",
          )}
        >
          <Icon className="size-4" /> {label}
        </Link>
      ))}
    </nav>
  );
}
