"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isTabActive } from "@/lib/nav-config";
import type { ToolLink } from "@/lib/event-tools";
import { cn } from "@/lib/utils";
import { TOOL_LINK_ICONS } from "./nav-icons";

/**
 * Horizontal, scrollable tool tabs of an event or group workspace. The active
 * tab comes from the path; the first link is the overview and matches only its
 * own path. The links are already filtered (module on, permission held).
 */
export function WorkspaceTabs({ links, label }: { links: ToolLink[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="border-border flex min-w-max gap-1 border-b">
        {links.map((link, index) => {
          const active = isTabActive({ href: link.href, exact: index === 0 }, pathname);
          const Icon = TOOL_LINK_ICONS[link.icon];
          return (
            <li key={link.key}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active ? "border-primary text-foreground" : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                <Icon className="size-4" />
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
