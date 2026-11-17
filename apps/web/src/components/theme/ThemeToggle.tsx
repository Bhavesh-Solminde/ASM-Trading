"use client";
import { Icon } from "@/components/shell/Icon";
import { readTheme, setTheme, useTheme } from "@/lib/theme";

export function ThemeToggle({ row = false }: { row?: boolean }) {
  const theme = useTheme();
  return <button type="button" aria-pressed={theme === "light"}
    aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
    onClick={() => setTheme(readTheme() === "light" ? "dark" : "light")}
    className={row ? "flex min-h-14 w-full items-center gap-3 rounded-xl px-4 text-left text-ink hover:bg-tile" : "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-tile hover:text-ink"}>
    <span className="theme-dark-icon"><Icon name="sun" /></span>
    <span className="theme-light-icon"><Icon name="moon" /></span>
    {row && <><span>Appearance</span><span className="ml-auto text-sm text-ink-2"><span className="theme-dark-icon">Dark</span><span className="theme-light-icon">Light</span></span></>}
  </button>;
}
