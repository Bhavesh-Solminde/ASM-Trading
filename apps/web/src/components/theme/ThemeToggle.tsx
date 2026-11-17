"use client";
import { Icon } from "@/components/shell/Icon";
import { readTheme, setTheme, useTheme } from "@/lib/theme";

export function ThemeToggle({ row = false, presentation, className = "" }: { row?: boolean; presentation?: "segmented"; className?: string }) {
  const theme = useTheme();
  if (presentation === "segmented") return (
    <div className={`${className} theme-segmented`} role="group" aria-label="Page appearance">
      <button type="button" aria-label="Use light theme" aria-pressed={theme === "light"} data-theme-choice="light" onClick={() => setTheme("light")}>
        <Icon name="sun" /><span>Light</span>
      </button>
      <button type="button" aria-label="Use dark theme" aria-pressed={theme === "dark"} data-theme-choice="dark" onClick={() => setTheme("dark")}>
        <Icon name="moon" /><span>Dark</span>
      </button>
    </div>
  );
  return <button type="button"
    aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
    onClick={() => setTheme(readTheme() === "light" ? "dark" : "light")}
    className={row ? "flex min-h-14 w-full items-center gap-3 rounded-xl px-4 text-left text-ink hover:bg-tile" : "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-tile hover:text-ink"}>
    <span className="theme-dark-icon"><Icon name="sun" /></span>
    <span className="theme-light-icon"><Icon name="moon" /></span>
    {row && <><span>Appearance</span><span className="ml-auto text-sm text-ink-2"><span className="theme-dark-icon">Dark</span><span className="theme-light-icon">Light</span></span></>}
  </button>;
}
