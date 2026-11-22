"use client";

import { useEffect, useState } from "react";
import { Laptop, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * ThemeToggle — Light / Dark / System menu button for the console header.
 * Writes `data-theme="light|dark"` on <html> (globals.css reads it; "system"
 * removes the attribute so prefers-color-scheme decides) and remembers the
 * choice in localStorage under `tbook-theme`.
 *
 * No props. Wire it in the header: `<ThemeToggle />`. To avoid a flash of the
 * wrong theme on first paint, render `<ThemeInitScript />` (components/theme-init-script.tsx)
 * in the root layout's <head>, and give <html> `suppressHydrationWarning`.
 */
type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "tbook-theme";

function readStored(): Theme {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    // Reading localStorage is only possible after mount.
    setTheme(readStored());
  }, []);

  function choose(next: string) {
    const value: Theme = next === "light" || next === "dark" ? next : "system";
    setTheme(value);
    apply(value);
    try {
      if (value === "system") window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Private mode or blocked storage: the choice still applies to this tab.
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change theme">
          {theme === "light" ? <Sun /> : theme === "dark" ? <Moon /> : <Laptop />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={choose}>
          <DropdownMenuRadioItem value="light">
            <Sun /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Laptop /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
