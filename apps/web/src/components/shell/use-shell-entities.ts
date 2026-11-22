"use client";

import { useCallback, useEffect, useState } from "react";
import { loadShellEntitiesAction, type ShellEntities } from "./shell-actions";

const TTL_MS = 30_000;
const NONE: ShellEntities = { events: [], groups: [] };

let cached: { at: number; value: ShellEntities } | null = null;
let inflight: Promise<ShellEntities> | null = null;

/** Shared, 30 s cached load of the org's event and group names (palette, breadcrumbs, sidebar fallback). */
export function loadShellEntities(): Promise<ShellEntities> {
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.value);
  inflight ??= loadShellEntitiesAction()
    .then((value) => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** `enabled` loads on mount; `refresh` can be called later (e.g. when the palette opens). */
export function useShellEntities(enabled: boolean): { entities: ShellEntities; refresh: () => void } {
  const [entities, setEntities] = useState<ShellEntities>(cached?.value ?? NONE);
  const refresh = useCallback(() => {
    loadShellEntities()
      .then(setEntities)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);
  return { entities, refresh };
}
