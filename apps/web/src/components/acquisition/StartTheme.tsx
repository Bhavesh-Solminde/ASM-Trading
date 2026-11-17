import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import styles from "@/app/start/start.module.css";

// The root bootstrap resolves the saved global choice, legacy /start choice,
// then the device default before paint. CSS uses that same document theme.
export function StartTheme({ children }: { children: ReactNode }) {
  return <div className={styles.page} data-start-page>{children}</div>;
}

export function StartThemeToggle() {
  return <ThemeToggle presentation="segmented" className={styles.themeToggle ?? ""} />;
}
