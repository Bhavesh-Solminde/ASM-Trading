"use client";

import { useEffect, useState } from "react";
import { Icon } from "../_lib/icons";

export function ThemeControl() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const root = document.getElementById("admin-root");
    setTheme(root?.dataset.adminTheme === "light" ? "light" : "dark");
  }, []);

  function set(next: "light" | "dark") {
    const root = document.getElementById("admin-root");
    if (root) root.dataset.adminTheme = next;
    document.cookie = `asm_admin_theme=${next}; path=/; max-age=31536000; samesite=lax`;
    setTheme(next);
  }

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button
        className={`admin-btn admin-btn--sm ${theme === "light" ? "admin-btn--primary" : "admin-btn--ghost"}`}
        onClick={() => set("light")}
      >
        <Icon name="sun" size={14} />
        Light
      </button>
      <button
        className={`admin-btn admin-btn--sm ${theme === "dark" ? "admin-btn--primary" : "admin-btn--ghost"}`}
        onClick={() => set("dark")}
      >
        <Icon name="moon" size={14} />
        Dark
      </button>
    </div>
  );
}
