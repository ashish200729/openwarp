"use client";

import { MoonIcon, SunIcon } from "@/components/icons";
import { themeCookie, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const next: Theme = dark ? "light" : "dark";
  root.dataset.theme = next;
  // The server reads this cookie so the saved theme is in the first response.
  document.cookie = `${themeCookie}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

export function ThemeToggle({ className }: { className?: string }) {
  return <button type="button" onClick={toggleTheme} aria-label="Switch color theme" title="Switch color theme"
    className={cn("grid size-11 shrink-0 place-items-center rounded-[7px] text-muted hover:bg-raised hover:text-foreground pointer-fine:size-9", className)}>
    <MoonIcon aria-hidden="true" size={17} className="dark:hidden" />
    <SunIcon aria-hidden="true" size={17} className="hidden dark:block" />
  </button>;
}
