"use client";

import { useSyncExternalStore } from "react";

const KEY = "asm_otc_sltp";
const EVENT = "asm:otc-sltp";
const serverSnapshot = () => false;

function read() {
  try { return localStorage.getItem(KEY) === "on"; } catch { return false; }
}

function subscribe(update: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) update();
  };
  window.addEventListener(EVENT, update);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(EVENT, update);
    window.removeEventListener("storage", storage);
  };
}

export function useOtcSltp() {
  return useSyncExternalStore(subscribe, read, serverSnapshot);
}

export function setOtcSltp(enabled: boolean) {
  try { localStorage.setItem(KEY, enabled ? "on" : "off"); } catch { return; }
  window.dispatchEvent(new Event(EVENT));
}
