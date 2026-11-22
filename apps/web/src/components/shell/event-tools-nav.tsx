import Link from "next/link";
import { Puzzle } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { SectionCard } from "@/components/section-card";
import { Card } from "@/components/ui/card";
import type { EventTool, EventToolContext } from "@/lib/event-tools";
import { EVENT_TOOL_ICONS } from "./nav-icons";

/**
 * The tools that are switched on for one event (or group) and open to this
 * member, as a grid of link cards. When there are none it explains where
 * the switches are instead of showing an empty grid.
 */
export function EventToolsNav({
  tools,
  context,
  title = "Event tools",
  description = "Everything switched on for this event, in one place.",
  emptyHint,
}: {
  tools: EventTool[];
  context: EventToolContext;
  title?: string;
  description?: string;
  emptyHint?: string;
}) {
  return (
    <SectionCard title={title} description={description}>
      {tools.length === 0 ? (
        <EmptyState
          icon={<Puzzle />}
          title="No tools are switched on yet"
          hint={emptyHint ?? "Switch on what this event uses in the Modules section below, and its tools will appear here."}
        />
      ) : (
        <nav aria-label={title}>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {tools.map((tool) => {
              const Icon = EVENT_TOOL_ICONS[tool.icon];
              return (
                <li key={tool.key}>
                  <Link href={tool.href(context)} className="group block h-full rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                    <Card className="hover:bg-accent h-full cursor-pointer flex-row items-start gap-3 px-4 py-3 shadow-none transition-colors">
                      <div className="bg-muted text-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{tool.label}</p>
                        <p className="text-muted-foreground text-xs">{tool.description}</p>
                      </div>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </SectionCard>
  );
}
