"use client";

import { useSyncExternalStore } from "react";
export type Theme = "light" | "dark";
const listeners = new Set<() => void>();
let channel: BroadcastChannel | undefined;
// Only retain an override when cookies cannot remember a choice. A readable,
// writable cookie stays authoritative across tabs and client navigations.
let sessionChoice: Theme | undefined;
let transitionFrame = 0;
const isAdmin = () => /^\/admin(?:\/|$)/.test(location.pathname);
export function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
export function cookieTheme(cookie: string): Theme {
  return /(?:^|;\s*)ixt_theme=light(?:;|$)/.test(cookie) ? "light" : "dark";
}
function savedTheme(): Theme | undefined {
  try { return document.cookie.match(/(?:^|;\s*)ixt_theme=(light|dark)(?:;|$)/)?.[1] as Theme | undefined; }
  catch { return undefined; }
}
function syncChrome() {
  // The blocking script may colour the server meta before React hydrates it.
  // Keep the newest React-managed node if metadata hydration/streaming adds one.
  const metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
  const meta = metas.at(-1);
  for (const duplicate of metas.slice(0, -1)) duplicate.remove();
  const color = meta && getComputedStyle(document.documentElement).getPropertyValue("--color-ground").trim();
  if (meta && color) meta.content = color;
}
function updateDocument(next: Theme) {
  const changed = readTheme() !== next;
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  syncChrome();
  if (changed) listeners.forEach(listener => listener());
}
function connect() {
  if (channel || typeof BroadcastChannel === "undefined") return;
  try {
    channel = new BroadcastChannel("ixt-theme");
    channel.onmessage = ({ data }) => {
      if (data !== "light" && data !== "dark") return;
      if (isAdmin()) {
        // Remember cross-tab changes while keeping admin fully dark. Admin
        // never writes a preference, including when cookies are unavailable.
        sessionChoice = savedTheme() === data ? undefined : data;
      } else applyTheme(data, false);
    };
  } catch { /* Cross-tab messaging is optional in restricted browsers. */ }
}
function applyTheme(next: Theme, broadcast: boolean) {
  if (isAdmin()) return;
  try {
    document.cookie = `ixt_theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  } catch { /* Verify readback below: some browsers silently reject writes. */ }
  sessionChoice = savedTheme() === next ? undefined : next;
  const root = document.documentElement;
  root.classList.add("theme-changing");
  if (transitionFrame) cancelAnimationFrame(transitionFrame);
  updateDocument(next);
  // Keep transitions suppressed through the paint that applies the new theme.
  transitionFrame = requestAnimationFrame(() => {
    transitionFrame = requestAnimationFrame(() => {
      root.classList.remove("theme-changing"); transitionFrame = 0;
    });
  });
  if (broadcast) { connect(); try { channel?.postMessage(next); } catch { /* Optional. */ } }
}
export function setTheme(next: Theme) { if (next === "light" || next === "dark") applyTheme(next, true); }
export function subscribe(listener: () => void) {
  connect(); listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useTheme() { return useSyncExternalStore(subscribe, readTheme, () => "dark" as const); }

/** Route changes never persist a forced admin or special-page appearance. */
export function syncRouteTheme() {
  let choice = sessionChoice ?? savedTheme();
  if (!choice && /^\/start\/?$/.test(location.pathname)) {
    try { choice = document.cookie.match(/(?:^|;\s*)ixt_start_theme=(light|dark)(?:;|$)/)?.[1] as Theme | undefined; }
    catch { /* A blocked cookie still permits the device default on /start. */ }
    if (!choice) {
      try { choice = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; }
      catch { choice = "dark"; }
    }
  }
  updateDocument(isAdmin() ? "dark" : choice ?? "dark");
}

/** React can stream metadata after this component hydrates. Keep one chrome tag. */
export function watchThemeChrome() {
  if (typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(records => {
    if (records.some(record => Array.from(record.addedNodes).some(node => node instanceof Element && node.matches('meta[name="theme-color"]')))) syncChrome();
  });
  observer.observe(document.head, { childList: true });
  return () => observer.disconnect();
}
