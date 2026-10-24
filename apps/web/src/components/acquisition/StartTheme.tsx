"use client";

import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import styles from "@/app/start/start.module.css";

type Theme = "light" | "dark";
const ThemeContext = createContext<{ theme: Theme; choose: (theme: Theme) => void } | null>(null);
const darkQuery = "(prefers-color-scheme: dark)";

function subscribe(callback: () => void) {
  const media = window.matchMedia(darkQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

export function StartTheme({ initialTheme, children }: { initialTheme: Theme | null; children: ReactNode }) {
  const [preference, setPreference] = useState(initialTheme);
  const systemDark = useSyncExternalStore(subscribe, () => window.matchMedia(darkQuery).matches, () => false);
  const theme = preference ?? (systemDark ? "dark" : "light");

  function choose(next: Theme) {
    setPreference(next);
    // A server-readable preference prevents a flash of the wrong theme on reload.
    // The narrow path keeps this preference specific to the ad landing page.
    try {
      document.cookie = `ixt_start_theme=${next}; Path=/start; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    } catch { /* The toggle still works when browser storage is blocked. */ }
  }

  return (
    <ThemeContext.Provider value={{ theme, choose }}>
      <div className={styles.page} data-theme={preference ?? undefined}>{children}</div>
    </ThemeContext.Provider>
  );
}

export function StartThemeToggle() {
  const context = useContext(ThemeContext);
  if (!context) return null;
  return (
    <div className={styles.themeToggle} role="group" aria-label="Page appearance">
      <button type="button" aria-label="Use light theme" aria-pressed={context.theme === "light"} onClick={() => context.choose("light")}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
        </svg>
        <span>Light</span>
      </button>
      <button type="button" aria-label="Use dark theme" aria-pressed={context.theme === "dark"} onClick={() => context.choose("dark")}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M20.5 13.2A8.7 8.7 0 0 1 10.8 3.5a8.7 8.7 0 1 0 9.7 9.7Z" />
        </svg>
        <span>Dark</span>
      </button>
    </div>
  );
}
