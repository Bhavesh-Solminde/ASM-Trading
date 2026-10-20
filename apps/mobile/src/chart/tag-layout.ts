import type { CandleDto } from "@asm/contracts";

/** Horizontal padding inside a tag, each side. */
const TAG_PAD = 6;
/** Gap between a tag and the edge it hangs from. */
const TAG_EDGE = 4;

export interface TagRect {
  x: number;
  w: number;
  textX: number;
}

/** The last-price tag: right-aligned to the axis (4 in), sized to its text, and it may overlap the plot like the canvas's. */
export function priceTagRect(plotW: number, axis: number, textW: number): TagRect {
  const w = textW + TAG_PAD * 2;
  const x = plotW + axis - TAG_EDGE - w;
  return { x, w, textX: x + TAG_PAD };
}

/** Tags are 22 high; two tags closer than this vertically overlap. */
const TAG_H = 22;

/**
 * The open-trade tag: right-aligned inside the plot (4 in), or, when `avoidX` is given (the price tag's x), ending
 * 4 before that x so the two never overlap.
 */
export function tradeTagRect(plotW: number, textW: number, avoidX: number | null = null): TagRect {
  const w = textW + TAG_PAD * 2;
  const x = (avoidX === null ? plotW : avoidX) - w - TAG_EDGE;
  return { x, w, textX: x + TAG_PAD };
}

/** The x a trade tag must end before: the price tag's x when the two tags are less than 22 apart vertically, else null. */
export function tradeAvoidX(tradeY: number, priceY: number | null, priceTagX: number): number | null {
  return priceY !== null && Math.abs(tradeY - priceY) < TAG_H ? priceTagX : null;
}

/** Keeps a 22-high tag centred on `y` inside the plot. */
export function clampTagY(y: number, height: number): number {
  return Math.min(height - TAG_H / 2, Math.max(TAG_H / 2, y));
}

/**
 * Index of the candle whose period holds `entryTs` (the last candle opened at or before it), or -1 when it is
 * before the first one (the caller clamps the line to x = 0). `candles` is oldest first, forming candle last.
 */
export function entryIndex(candles: readonly CandleDto[], entryTs: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid]!.openTs <= entryTs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Three horizontal grid rules, evenly spaced over the plot height. */
export function gridYs(height: number): [number, number, number] {
  return [height / 4, height / 2, (height * 3) / 4];
}

/** The OHLC readout's box: below the overlay row (`topInset`), clear of the price tags on the right. */
export function readoutBox(topInset: number, axis: number): { top: number; left: number; right: number } {
  return { top: Number.isFinite(topInset) ? Math.max(0, topInset) : 0, left: 6, right: axis + 6 };
}

/** The readout shows for a crosshair candle, except while the chart-tools panel (which covers its spot) is open. */
export function showReadout(a: { hide: boolean; hasCandle: boolean }): boolean {
  return a.hasCandle && !a.hide;
}

/** True when a Skia tag's text holds a glyph Martian Mono lacks (Hindi words, "…"), so it needs the Anek font. */
export function hasNonAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0x7f) return true;
  return false;
}
