import { useEffect, useState } from "react";

/**
 * Epoch milliseconds, refreshed every `intervalMs` (null pauses ticking). Whatever calls this re-renders on
 * every tick, so call it only in small leaf components (the clock, a countdown), never in a screen.
 */
export function useNow(intervalMs: number | null = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
