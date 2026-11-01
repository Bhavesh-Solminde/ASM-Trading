"use client";

import { useSyncExternalStore } from "react";

const KEY = "asm_chart_protection";
const EVENT = "asm:chart-protection";
function read() { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } }
function subscribe(update: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) update(); };
  window.addEventListener(EVENT, update); window.addEventListener("storage", storage);
  return () => { window.removeEventListener(EVENT, update); window.removeEventListener("storage", storage); };
}
export function useChartProtection() { return useSyncExternalStore(subscribe, read, () => true); }
export function setChartProtection(enabled: boolean) {
  try { localStorage.setItem(KEY, enabled ? "on" : "off"); } catch { return; }
  window.dispatchEvent(new Event(EVENT));
}
