export type ChartType = "candles" | "line" | "area" | "bars";

export interface Viewport {
  width: number;
  height: number;
  /** Fractional index of the right edge; the live edge is `candles.length`. */
  rightIndex: number;
  visibleCount: number;
}

export interface PriceRange {
  min: number;
  max: number;
}
