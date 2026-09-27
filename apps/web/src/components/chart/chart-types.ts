import type { IconName } from "@/components/shell/Icon";

export type ChartType =
  | "bars"
  | "candles"
  | "hollow_candles"
  | "volume_candles"
  | "hlc_bars"
  | "line"
  | "line_markers"
  | "step_line"
  | "area"
  | "hlc_area"
  | "baseline";

export interface ChartTypeOption {
  readonly id: ChartType;
  readonly label: string;
  readonly description: string;
  readonly icon: IconName;
  readonly category: "bar" | "candle" | "line" | "area";
}

export const CHART_TYPES: readonly ChartTypeOption[] = [
  {
    id: "bars",
    label: "Bars",
    description: "Traditional OHLC tick bars",
    icon: "bars",
    category: "bar",
  },
  {
    id: "candles",
    label: "Candles",
    description: "Classic OHLC candlesticks",
    icon: "candles",
    category: "candle",
  },
  {
    id: "hollow_candles",
    label: "Hollow candles",
    description: "Trend-colored hollow bodies",
    icon: "hollow_candles",
    category: "candle",
  },
  {
    id: "volume_candles",
    label: "Volume candles",
    description: "Volume-weighted candle bodies",
    icon: "volume_candles",
    category: "candle",
  },
  {
    id: "hlc_bars",
    label: "HLC bars",
    description: "Bars without open tick",
    icon: "hlc_bars",
    category: "bar",
  },
  {
    id: "line",
    label: "Line",
    description: "Continuous close-price curve",
    icon: "line",
    category: "line",
  },
  {
    id: "line_markers",
    label: "Line with markers",
    description: "Line with vertex markers",
    icon: "line_markers",
    category: "line",
  },
  {
    id: "step_line",
    label: "Step line",
    description: "Discrete price steps",
    icon: "step_line",
    category: "line",
  },
  {
    id: "area",
    label: "Area",
    description: "Gradient filled price area",
    icon: "area",
    category: "area",
  },
  {
    id: "hlc_area",
    label: "HLC area",
    description: "High-low band with close line",
    icon: "hlc_area",
    category: "area",
  },
  {
    id: "baseline",
    label: "Baseline",
    description: "P&L split against baseline level",
    icon: "baseline",
    category: "area",
  },
] as const;
