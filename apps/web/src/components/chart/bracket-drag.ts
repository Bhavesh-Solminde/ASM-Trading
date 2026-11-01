import { snapBracketPrice } from "./bracket-model";

export type BracketDragRange = { from: number; to: number };

/** The gesture uses its original price/pixel ratio, even when the chart zooms. */
export function draggedBracketPrice(anchor: number, pixels: number, pricePerPixel: number, tick: number, precision: number): number {
  return Math.max(tick, snapBracketPrice(anchor - pixels * pricePerPixel, tick, precision));
}

/** Expand only; never shrink or move a level's value to make it fit. */
export function expandedBracketRange(range: BracketDragRange, price: number, tick: number): BracketDragRange {
  const pad = Math.max((range.to - range.from) * .08, tick * 4);
  return { from: Math.max(tick, Math.min(range.from, price - pad)), to: Math.max(range.to, price + pad) };
}
