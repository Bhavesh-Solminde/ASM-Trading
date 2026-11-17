import { ColorType, type DeepPartial, type ChartOptions, type IChartApi, type ISeriesApi } from "lightweight-charts";
import { readTheme } from "@/lib/theme";
import type { ChartType } from "./chart-types";

const tokens = {
  classic: "chart-classic", market: "chart-market", axis: "chart-axis", marketAxis: "chart-market-axis",
  grid: "chart-grid", marketGrid: "chart-market-grid", border: "chart-border", crosshair: "chart-crosshair",
  marketCrosshair: "chart-market-crosshair", crosshairLabel: "chart-crosshair-label", accent: "chart-accent",
  labelInk: "chart-label-ink", up: "candle-up", down: "candle-down", close: "chart-hlc-close",
  watermark: "chart-watermark", baselineUp: "chart-baseline-up", baselineDown: "chart-baseline-down",
  volumeDefaultUp: "chart-volume-default-up", volumeDefaultDown: "chart-volume-default-down",
  buy: "chart-buy", SMA: "chart-sma", EMA: "chart-ema", RSI: "chart-rsi",
} as const;
export type ChartPalette = Record<keyof typeof tokens, string> & { font: string };
let cached: { theme: string; root: HTMLElement; palette: ChartPalette } | undefined;

/** Shared by all charts/overlays. No computed-style reads in tick or paint loops. */
export function getChartPalette(): ChartPalette {
  const theme = readTheme(), root = document.documentElement;
  if (cached?.theme === theme && cached.root === root) return cached.palette;
  const style = getComputedStyle(root);
  const palette = Object.fromEntries(Object.entries(tokens).map(([key, token]) => [key, style.getPropertyValue(`--color-${token}`).trim() || "transparent"])) as ChartPalette;
  palette.font = style.getPropertyValue("--font-ui").trim() || "sans-serif";
  cached = { theme, root, palette };
  return palette;
}

/** Token values are hex/rgb; lightweight-charts does not understand CSS var()/color-mix(). */
export function chartAlpha(color: string, alpha: number): string {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const expanded = hex.length === 3 ? hex.split("").map(c => c + c).join("") : hex;
    return `rgba(${parseInt(expanded.slice(0, 2), 16)}, ${parseInt(expanded.slice(2, 4), 16)}, ${parseInt(expanded.slice(4, 6), 16)}, ${alpha})`;
  }
  const channels = color.match(/[\d.]+/g);
  return channels?.length ? `rgba(${channels.slice(0, 3).join(", ")}, ${alpha})` : color;
}

export function chartThemeOptions(p: ChartPalette, market: boolean): DeepPartial<ChartOptions> {
  return {
    layout: { background: { type: ColorType.Solid, color: market ? p.market : p.classic }, textColor: market ? p.marketAxis : p.axis },
    grid: { vertLines: { color: market ? p.marketGrid : p.grid }, horzLines: { color: market ? p.marketGrid : p.grid } },
    rightPriceScale: { borderColor: p.border }, timeScale: { borderColor: p.border },
    crosshair: { vertLine: { color: market ? p.marketCrosshair : p.crosshair, labelBackgroundColor: p.crosshairLabel }, horzLine: { color: market ? p.marketCrosshair : p.crosshair, labelBackgroundColor: p.crosshairLabel } },
  };
}

/** Only appearance options: no data, viewport, crosshair or simulation changes. */
export function applyChartSeriesTheme(series: ISeriesApi<any>, type: ChartType, p: ChartPalette) {
  switch (type) {
    case "bars": case "hlc_bars": series.applyOptions({ upColor: p.up, downColor: p.down }); break;
    case "candles": case "volume_candles": series.applyOptions({ upColor: p.up, downColor: p.down, wickUpColor: p.up, wickDownColor: p.down }); break;
    case "hollow_candles": series.applyOptions({ upColor: "transparent", downColor: p.down, borderColor: p.up, borderUpColor: p.up, borderDownColor: p.down, wickUpColor: p.up, wickDownColor: p.down }); break;
    case "hlc_area": series.applyOptions({ highLineColor: p.up, highFillColor: chartAlpha(p.up, .2), lowLineColor: p.down, lowFillColor: chartAlpha(p.down, .2), closeLineColor: p.close }); break;
    case "area": series.applyOptions({ lineColor: p.accent, topColor: chartAlpha(p.accent, .38), bottomColor: chartAlpha(p.accent, 0) }); break;
    case "baseline": series.applyOptions({ topLineColor: p.up, bottomLineColor: p.down, topFillColor1: chartAlpha(p.baselineUp, .3), topFillColor2: chartAlpha(p.baselineUp, 0), bottomFillColor1: chartAlpha(p.baselineDown, 0), bottomFillColor2: chartAlpha(p.baselineDown, .3) }); break;
    default: series.applyOptions({ color: p.accent });
  }
}

export function applyChartTheme(chart: IChartApi, series: ISeriesApi<any>, type: ChartType, p: ChartPalette, market: boolean) {
  chart.applyOptions(chartThemeOptions(p, market));
  applyChartSeriesTheme(series, type, p);
}
