import type { TradeView } from "@asm/contracts";

/** Circumference of the strip's r=14 countdown ring. */
export const RING_LENGTH = 2 * Math.PI * 14;

/** Time left as "m:ss" (or "h:mm:ss" from an hour up); rounds up so it reads 0:01 until the last second. */
export function shortCountdown(totalSec: number): string {
  const s = Math.max(0, Math.ceil(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** stroke-dashoffset for a ring that starts full and empties as the trade runs out. */
export function ringOffset(remainingSec: number, totalSec: number): number {
  if (totalSec <= 0) return RING_LENGTH;
  const left = Math.min(1, Math.max(0, remainingSec / totalSec));
  return RING_LENGTH * (1 - left);
}

/** The open trade that expires first, and how many other open trades there are. */
export function soonestOpen(trades: readonly TradeView[]): { trade: TradeView; more: number } | null {
  let best: TradeView | null = null;
  let count = 0;
  for (const t of trades) {
    if (t.status !== "OPEN") continue;
    count += 1;
    if (best === null || t.expiryTs < best.expiryTs) best = t;
  }
  return best === null ? null : { trade: best, more: count - 1 };
}
