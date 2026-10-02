"use client";

import { useSyncExternalStore } from "react";
import { isSymbolClosedForNight } from "@asm/algo";

const listeners = new Set<() => void>();
let current = Math.floor(Date.now() / 1000);
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    current = Math.floor(Date.now() / 1000);
    // Polled faster than once a second so displayed clocks roll over on time;
    // React skips the render when the second has not changed.
    timer = setInterval(() => {
      current = Math.floor(Date.now() / 1000);
      for (const l of listeners) l();
    }, 250);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/**
 * The current time in whole epoch seconds, shared by every clock on the page.
 * Null during server render, so no clock text can cause a hydration mismatch.
 */
export function useNowSec(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

/**
 * Whether `symbol` is inside its nightly close (India indices, 23:30–05:00
 * IST) — the same check the engine refuses opens with. Re-renders only when
 * the answer flips, so the ticket re-enables itself at the reopen.
 */
export function useMarketClosed(symbol: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isSymbolClosedForNight(symbol, current * 1000),
    () => false,
  );
}
