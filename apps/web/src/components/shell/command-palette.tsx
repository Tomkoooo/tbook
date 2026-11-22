"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, FolderKanban, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { EVENT_TOOLS } from "@/lib/event-tools";
import { eventPath, groupPath } from "@/lib/event-routes";
import type { NavItem } from "@/lib/nav-config";
import { EVENT_TOOL_ICONS, NAV_ICONS, TOOL_LINK_ICONS } from "./nav-icons";
import type { ShellEntities } from "./shell-actions";
import type { WorkspaceInfo } from "./workspace-store";

/** At most this many "Bus — Event name" entries are listed for a search. */
const MAX_EVENT_TOOL_RESULTS = 30;

/**
 * ⌘K / Ctrl+K command palette: jump to any page the member can open, to the
 * tools of the event / group you are in, to an event or event group by name,
 * or straight to one event's tool ("Bus — Event name"). `pages` is already
 * filtered by module and permission; the events and groups come from the
 * header, `workspace` is the event / group the current page is in (if any).
 */
export function CommandPalette({
  pages,
  entities,
  workspace,
  onOpen,
}: {
  pages: NavItem[];
  entities: ShellEntities;
  workspace: WorkspaceInfo | null;
  onOpen: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Per-event tools are only listed once the member types: hundreds of rows otherwise.
  const eventToolMatches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (query.trim().length < 2) return [];
    const matches: Array<{ key: string; label: string; href: string; icon: keyof typeof EVENT_TOOL_ICONS }> = [];
    for (const event of entities.events) {
      for (const toolKey of event.tools) {
        const tool = EVENT_TOOLS.find((candidate) => candidate.key === toolKey);
        if (!tool) continue;
        const label = `${tool.shortLabel ?? tool.label} — ${event.name}`;
        const haystack = label.toLowerCase();
        if (!words.every((word) => haystack.includes(word))) continue;
        matches.push({ key: `${event.id}:${tool.key}`, label, href: eventPath(event.id, tool.slug), icon: tool.icon });
        if (matches.length >= MAX_EVENT_TOOL_RESULTS) return matches;
      }
    }
    return matches;
  }, [query, entities.events]);

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
      <CommandDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
        title="Search"
        description="Jump to a page, event, event group or an event's tool."
      >
        <CommandInput placeholder="Search pages, events, groups and tools…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>Nothing found.</CommandEmpty>
          {workspace ? (
            <CommandGroup heading={workspace.name}>
              {workspace.links.map((link) => {
                const Icon = TOOL_LINK_ICONS[link.icon];
                return (
                  <CommandItem key={link.key} value={`here ${workspace.name} ${link.label}`} onSelect={() => go(link.href)}>
                    <Icon /> {link.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}
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
          {eventToolMatches.length > 0 ? (
            <CommandGroup heading="Event tools">
              {eventToolMatches.map((match) => {
                const Icon = EVENT_TOOL_ICONS[match.icon];
                return (
                  <CommandItem key={match.key} value={`tool ${match.label}`} onSelect={() => go(match.href)}>
                    <Icon /> <span className="truncate">{match.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}
          {entities.events.length > 0 ? (
            <CommandGroup heading="Events">
              {entities.events.map((event) => (
                <CommandItem key={event.id} value={`event ${event.name} ${event.startDate}`} onSelect={() => go(eventPath(event.id))}>
                  <CalendarDays /> <span className="truncate">{event.name}</span>
                  {event.startDate ? <span className="text-muted-foreground ml-auto text-xs tabular-nums">{event.startDate}</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {entities.groups.length > 0 ? (
            <CommandGroup heading="Event groups">
              {entities.groups.map((group) => (
                <CommandItem key={group.id} value={`group ${group.name}`} onSelect={() => go(groupPath(group.id))}>
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
