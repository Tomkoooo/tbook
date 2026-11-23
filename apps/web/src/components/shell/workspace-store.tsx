"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";
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

const SeedContext = createContext<WorkspaceInfo | null>(null);

/**
 * The server's own answer for the page being rendered (from the request path),
 * so the sidebar section and breadcrumbs are complete in the very first HTML.
 * Without it they would show a skeleton until the page hydrates and then jump.
 * The live registration below takes over once it exists.
 */
export function WorkspaceSeed({ info, children }: { info: WorkspaceInfo | null; children: ReactNode }) {
  return <SeedContext.Provider value={info}>{children}</SeedContext.Provider>;
}

/** The registered workspace if it is the `kind`/`id` asked for, else the server's seed for it, else null. */
export function useWorkspace(kind: WorkspaceInfo["kind"], id: string | null): WorkspaceInfo | null {
  const seed = useContext(SeedContext);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  const matches = (info: WorkspaceInfo | null) => (info && id && info.kind === kind && info.id === id ? info : null);
  return matches(snapshot) ?? matches(seed);
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
