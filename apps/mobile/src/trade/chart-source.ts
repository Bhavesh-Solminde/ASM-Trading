import type { ChartState } from "@asm/client-core";
import type { Timeframe } from "@asm/contracts";
import type { ResumeSnapshot } from "@/cache/codec";

export type ChartSource = "live" | "snapshot" | "empty";

/**
 * Where the candles on screen come from for the current selection.
 *  - "live": the chart holds candles for exactly this symbol and timeframe.
 *  - "snapshot": it has none yet, and the (stale) resume snapshot is for this very selection.
 *  - "empty": neither; paint nothing rather than another market's candles.
 * The caller passes `snapshot: null` once live candles have arrived this mount, so a stale snapshot is
 * never shown (or labelled) again.
 */
export function chartSource(i: {
  symbol: string;
  timeframe: Timeframe;
  chart: ChartState;
  snapshot: ResumeSnapshot | null;
}): ChartSource {
  const chartMatches = i.chart.symbol === i.symbol && i.chart.timeframe === i.timeframe;
  if (chartMatches && i.chart.candles.length > 0) return "live";
  const snapshotMatches = i.snapshot !== null && i.snapshot.symbol === i.symbol && i.snapshot.timeframe === i.timeframe;
  return snapshotMatches ? "snapshot" : "empty";
}
