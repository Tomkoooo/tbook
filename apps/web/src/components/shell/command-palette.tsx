"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, FolderKanban, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { NavItem } from "@/lib/nav-config";
import { NAV_ICONS } from "./nav-icons";
import type { ShellEntities } from "./shell-actions";

/**
 * ⌘K / Ctrl+K command palette: jump to any page the member can open, or to
 * an event or event group by name. `pages` is already filtered by module
 * and permission; the events and groups come from the header.
 */
export function CommandPalette({ pages, entities, onOpen }: { pages: NavItem[]; entities: ShellEntities; onOpen: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) onOpen();
  }, [open, onOpen]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <Button variant="outline" size="sm" className="text-muted-foreground ml-auto gap-2 font-normal" onClick={() => setOpen(true)} aria-label="Search pages and events">
        <Search />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="bg-muted text-muted-foreground pointer-events-none hidden rounded border px-1.5 font-mono text-[11px] sm:inline">⌘K</kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Jump to a page, event or event group.">
        <CommandInput placeholder="Search pages, events and groups…" />
        <CommandList>
          <CommandEmpty>Nothing found.</CommandEmpty>
          <CommandGroup heading="Pages">
            {pages.map((page) => {
              const Icon = NAV_ICONS[page.icon];
              return (
                <CommandItem key={page.href} value={`page ${page.label}`} onSelect={() => go(page.href)}>
                  <Icon /> {page.label}
                </CommandItem>
              );
            })}
          </CommandGroup>
          {entities.events.length > 0 ? (
            <CommandGroup heading="Events">
              {entities.events.map((event) => (
                <CommandItem key={event.id} value={`event ${event.name} ${event.startDate}`} onSelect={() => go(`/admin/events/${event.id}`)}>
                  <CalendarDays /> <span className="truncate">{event.name}</span>
                  {event.startDate ? <span className="text-muted-foreground ml-auto text-xs tabular-nums">{event.startDate}</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {entities.groups.length > 0 ? (
            <CommandGroup heading="Event groups">
              {entities.groups.map((group) => (
                <CommandItem key={group.id} value={`group ${group.name}`} onSelect={() => go(`/admin/groups/${group.id}`)}>
                  <FolderKanban /> <span className="truncate">{group.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </CommandDialog>
    </>
  );
}
