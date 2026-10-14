import { useEffect, useState } from "react";
import { nowForRender } from "./now-model";

/**
 * Epoch milliseconds, refreshed every `intervalMs` (null pauses ticking). Whatever calls this re-renders on
 * every tick, so call it only in small leaf components (the clock, a countdown), never in a screen.
 * When ticking resumes after a pause the first render already reads the live clock, not the paused value.
 */
export function useNow(intervalMs: number | null = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  const ticking = intervalMs !== null;
  const [wasTicking, setWasTicking] = useState(ticking);
  // Derived state: adjusting it during render re-renders before paint, so the stale value is never shown.
  if (ticking !== wasTicking) {
    setWasTicking(ticking);
    if (ticking) setNow(Date.now());
  }
  useEffect(() => {
    if (intervalMs === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return nowForRender({ ticking, wasTicking, stored: now, clock: Date.now });
}
