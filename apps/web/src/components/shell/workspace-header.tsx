import type { ReactNode } from "react";
import type { ToolLink } from "@/lib/event-tools";
import { WorkspaceRegistrar, type WorkspaceInfo } from "./workspace-store";
import { WorkspaceTabs } from "./workspace-tabs";

/**
 * The block on top of an event or group workspace: name, status, meta line,
 * optional switcher, and the tool tabs. It also publishes the workspace to the
 * shell (sidebar section, breadcrumbs, palette). Pages render below it.
 * The name is not an <h1>: every page under it has its own title.
 */
export function WorkspaceHeader({
  info,
  status,
  meta,
  switcher,
  tabsLabel,
}: {
  info: WorkspaceInfo;
  /** A status Badge. */
  status?: ReactNode;
  /** Dates, group link… */
  meta?: ReactNode;
  /** The event switcher, on the right (wraps below the name on phones). */
  switcher?: ReactNode;
  tabsLabel: string;
}) {
  return (
    <div className="grid gap-3">
      <WorkspaceRegistrar info={info} />
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="grid min-w-0 gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="min-w-0 truncate text-xl font-semibold tracking-tight">{info.name}</p>
            {status}
          </div>
          {meta ? <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">{meta}</div> : null}
        </div>
        {switcher ? <div className="w-full sm:w-auto">{switcher}</div> : null}
      </div>
      <WorkspaceTabs links={info.links} label={tabsLabel} />
    </div>
  );
}

/** The overview link every workspace starts its tabs with. */
export function overviewLink(href: string): ToolLink {
  return { key: "overview", label: "Overview", href, icon: "overview" };
}
