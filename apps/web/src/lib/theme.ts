"use client";

import { useSyncExternalStore } from "react";
export type Theme = "light" | "dark";
const listeners = new Set<() => void>();
let channel: BroadcastChannel | undefined;
const isAdmin = () => /^\/admin(?:\/|$)/.test(location.pathname);
export function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
export function cookieTheme(cookie: string): Theme {
  return /(?:^|;\s*)ixt_theme=light(?:;|$)/.test(cookie) ? "light" : "dark";
}
function connect() {
  if (channel || typeof BroadcastChannel === "undefined") return;
  try {
    channel = new BroadcastChannel("ixt-theme");
    channel.onmessage = ({ data }) => {
      if (data === "light" || data === "dark") applyTheme(data, false);
    };
  } catch { /* Cross-tab messaging is optional in restricted browsers. */ }
}
function applyTheme(next: Theme, broadcast: boolean) {
  if (isAdmin()) return;
  const changed = readTheme() !== next;
  const root = document.documentElement;
  root.classList.add("theme-changing");
  root.dataset.theme = next;
  root.style.colorScheme = next;
  try {
    document.cookie = `ixt_theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  } catch { /* The in-memory choice still works with blocked cookies. */ }
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue("--color-ground").trim();
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-changing")));
  if (changed) listeners.forEach((listener) => listener());
  if (broadcast) { connect(); try { channel?.postMessage(next); } catch { /* optional */ } }
}
export function setTheme(next: Theme) { if (next === "light" || next === "dark") applyTheme(next, true); }
export function subscribe(listener: () => void) {
  connect(); listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useTheme() { return useSyncExternalStore(subscribe, readTheme, () => "dark" as const); }
