"use client";

import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import type { ToolLink } from "@/lib/event-tools";

/**
 * What the shell knows about the workspace (event or group) the page is in:
 * its name and the tool links this member may open. The workspace layouts
 * (server) render a <WorkspaceRegistrar> with this data; the sidebar's
 * contextual section, the breadcrumbs and the palette read it, so they show
 * the same tools as the tabs and never need a second fetch for the name.
 */
export interface WorkspaceInfo {
  kind: "event" | "group";
  id: string;
  name: string;
  links: ToolLink[];
}

let current: WorkspaceInfo | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The registered workspace if it is the `kind`/`id` asked for, else null. */
export function useWorkspace(kind: WorkspaceInfo["kind"], id: string | null): WorkspaceInfo | null {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  return snapshot && id && snapshot.kind === kind && snapshot.id === id ? snapshot : null;
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Renders nothing; publishes the workspace to the shell while it is mounted. */
export function WorkspaceRegistrar({ info }: { info: WorkspaceInfo }) {
  const serialized = JSON.stringify(info);
  useIsomorphicLayoutEffect(() => {
    const value = JSON.parse(serialized) as WorkspaceInfo;
    current = value;
    emit();
    return () => {
      if (current === value) {
        current = null;
        emit();
      }
    };
  }, [serialized]);
  return null;
}
