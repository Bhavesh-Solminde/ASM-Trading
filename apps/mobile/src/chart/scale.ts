import type { CandleDto } from "@asm/contracts";
import type { PriceRange, Viewport } from "./types";

export const MIN_VISIBLE = 15;
export const MAX_VISIBLE = 300;
/** Keep candles visible while allowing the same right-side breathing room as the website. */
export const rightLimit = (total: number, visibleCount: number) => total + Math.min(15, visibleCount / 2);
const PAD = 0.08;

export const clampVisible = (n: number) => Math.min(MAX_VISIBLE, Math.max(MIN_VISIBLE, n));

const step = (vp: Viewport) => vp.width / vp.visibleCount;
export const xForIndex = (i: number, vp: Viewport) => vp.width - (vp.rightIndex - i) * step(vp);
export const indexForX = (x: number, vp: Viewport) => vp.rightIndex - (vp.width - x) / step(vp);

export function visibleRange(vp: Viewport, total: number): { from: number; to: number } {
  const to = Math.min(total, Math.ceil(vp.rightIndex));
  const from = Math.max(0, Math.floor(vp.rightIndex - vp.visibleCount));
  return { from, to };
}

export function priceRange(candles: CandleDto[], from: number, to: number, extra: number[] = []): PriceRange {
  let min = Infinity;
  let max = -Infinity;
  for (let i = from; i < to; i++) {
    const c = candles[i];
    if (!c) continue;
    if (c.l < min) min = c.l;
    if (c.h > max) max = c.h;
  }
  for (const p of extra) {
    if (p < min) min = p;
    if (p > max) max = p;
  }
  if (!Number.isFinite(min)) return { min: 0, max: 1 };
  const span = max - min || Math.abs(max) * 0.001 || 1;
  return { min: min - span * PAD, max: max + span * PAD };
}

export const yForPrice = (p: number, r: PriceRange, h: number) => ((r.max - p) / (r.max - r.min)) * h;
export const priceForY = (y: number, r: PriceRange, h: number) => r.max - (y / h) * (r.max - r.min);

/** A viewport the maths can divide by: positive width/visibleCount and finite fields. */
const isUsable = (vp: Viewport) =>
  vp.width > 0 &&
  vp.visibleCount > 0 &&
  [vp.width, vp.height, vp.rightIndex, vp.visibleCount].every(Number.isFinite);

export function zoomAround(vp: Viewport, focusX: number, factor: number, total: number): Viewport {
  if (!isUsable(vp) || !Number.isFinite(focusX) || !Number.isFinite(factor) || !Number.isFinite(total)) return vp;
  const focusIndex = indexForX(focusX, vp);
  const visibleCount = clampVisible(vp.visibleCount / factor);
  // keep focusIndex under focusX at the new zoom level
  const rightIndex = focusIndex + (vp.width - focusX) / (vp.width / visibleCount);
  return { ...vp, visibleCount, rightIndex: Math.min(rightLimit(total, visibleCount), rightIndex) };
}

export function panBy(vp: Viewport, dx: number, total: number): Viewport {
  if (!isUsable(vp) || !Number.isFinite(dx) || !Number.isFinite(total)) return vp;
  const rightIndex = vp.rightIndex - dx / step(vp);
  // Bound empty future space to half the screen; dragging right still loads older candles.
  return { ...vp, rightIndex: Math.min(rightLimit(total, vp.visibleCount), Math.max(Math.min(total, MIN_VISIBLE / 2), rightIndex)) };
}

/** Older candles were prepended: shift the edge so the on-screen candles stay put. */
export const shiftForPrepend = (vp: Viewport, prepended: number): Viewport => ({
  ...vp,
  rightIndex: vp.rightIndex + prepended,
});

export const nearLeftEdge = (vp: Viewport, _total: number, threshold = 20) =>
  vp.rightIndex - vp.visibleCount <= threshold;

export type DragAxis = "pan" | "zoom";
export function dragAxis(dx: number, dy: number): DragAxis {
  return Math.abs(dy) > Math.abs(dx) * 1.2 ? "zoom" : "pan";
}
/** Vertical swipes zoom around the gesture's start. */
export function dragViewport(vp: Viewport, dx: number, dy: number, focusX: number, total: number, axis: DragAxis): Viewport {
  return axis === "pan" ? panBy(vp, dx, total) : zoomAround(vp, focusX, Math.exp(Math.max(-2, Math.min(2, -dy / 200))), total);
}
