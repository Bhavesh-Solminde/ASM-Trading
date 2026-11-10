import type { OtcDisplayQuote, Timeframe } from "@asm/contracts";

export interface DisplayedQuote extends OtcDisplayQuote {
  symbol: string;
  timeframe: Timeframe;
  generation: string;
}

// Written only after the price readout commits. A newer socket packet cannot change a tap's price.
let displayed: DisplayedQuote | null = null;
export function commitDisplayedQuote(quote: DisplayedQuote | null) { displayed = quote; }
export function clearDisplayedQuote() { displayed = null; }
export function displayedQuoteFor(symbol: string, timeframe: Timeframe, generation: string | undefined) {
  return displayed?.symbol === symbol && displayed.timeframe === timeframe && displayed.generation === generation ? displayed : null;
}
