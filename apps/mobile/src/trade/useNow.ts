import { useEffect, useState } from "react";

/**
 * Epoch milliseconds, refreshed every `intervalMs`. Whatever calls this re-renders on every tick, so call
 * it only in small leaf components (the clock, a countdown), never in a screen.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
