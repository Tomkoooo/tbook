import Link from "next/link";
import { Shirt, Ticket } from "lucide-react";
import { cn } from "@/lib/utils";

/** Large touch-friendly switch between selling tickets and merch at the counter. */
export function SalesTabs({ active }: { active: "tickets" | "merch" }) {
  const tabs = [
    { key: "tickets", href: "/admin/sales", label: "Tickets", icon: Ticket },
    { key: "merch", href: "/admin/sales/merch", label: "Merch", icon: Shirt },
  ] as const;
  return (
    <nav aria-label="What to sell" className="bg-muted grid w-full max-w-sm grid-cols-2 gap-1 rounded-lg p-1">
      {tabs.map(({ key, href, label, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          aria-current={active === key ? "page" : undefined}
          className={cn(
            "flex h-10 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors",
            active === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-4" /> {label}
        </Link>
      ))}
    </nav>
  );
}
