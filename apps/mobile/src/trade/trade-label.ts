import { countdownText } from "./countdown-text";

/**
 * The chart trade line's label: the same words as the position strip. Counts down to the expiry, then says
 * "Settling…" (never a frozen 0:00) until the engine's result removes the trade. `nowSec` is the chart's clock;
 * a cached (stale) trade passes its save time, so one cached after its expiry reads "Settling…" too.
 */
export function tradeLabel(expiryTs: number, nowSec: number, settling: string): string {
  return countdownText({ expired: nowSec >= expiryTs, remainingSec: Math.max(0, expiryTs - nowSec) }, settling);
}
