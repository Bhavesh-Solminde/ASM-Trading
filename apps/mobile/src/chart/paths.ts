import type { CandleDto } from "@asm/contracts";
import { xForIndex, yForPrice } from "./scale";
import type { ChartType, PriceRange, Viewport } from "./types";

const r = (n: number) => Math.round(n * 10) / 10;

export interface SeriesPaths {
  up: string;
  down: string;
  line?: string;
  area?: string;
}

/**
 * SVG path strings for the candles in [from, to) (`to` is exclusive, so passing
 * `to = candles.length - 1` excludes the forming candle). Skia accepts these via
 * `Skia.Path.MakeFromSVGString`.
 */
export function buildSeries(
  type: ChartType,
  candles: CandleDto[],
  from: number,
  to: number,
  vp: Viewport,
  range: PriceRange,
): SeriesPaths {
  if (to <= from) return { up: "", down: "" };
  const w = vp.width / vp.visibleCount;
  const half = Math.max(1, w * 0.35);
  const y = (p: number) => r(yForPrice(p, range, vp.height));
  const cx = (i: number) => r(xForIndex(i + 0.5, vp));

  if (type === "line" || type === "area") {
    const pts: string[] = [];
    for (let i = from; i < to; i++) {
      const c = candles[i];
      if (c) pts.push(`${cx(i)} ${y(c.c)}`);
    }
    const line = pts.length ? `M${pts.join(" L")}` : "";
    if (type === "line") return { up: "", down: "", line };
    const firstX = cx(from);
    const lastX = cx(to - 1);
    return {
      up: "",
      down: "",
      line,
      area: line ? `${line} L${lastX} ${vp.height} L${firstX} ${vp.height} Z` : "",
    };
  }

  const up: string[] = [];
  const down: string[] = [];
  for (let i = from; i < to; i++) {
    const c = candles[i];
    if (!c) continue;
    const x = cx(i);
    const target = c.c >= c.o ? up : down;
    if (type === "candles") {
      const top = y(Math.max(c.o, c.c));
      const bottom = Math.max(y(Math.min(c.o, c.c)), top + 1);
      target.push(`M${x} ${y(c.h)} L${x} ${y(c.l)}`);
      target.push(`M${r(x - half)} ${top} L${r(x + half)} ${top} L${r(x + half)} ${bottom} L${r(x - half)} ${bottom} Z`);
    } else {
      target.push(`M${x} ${y(c.h)} L${x} ${y(c.l)}`);
      target.push(`M${r(x - half)} ${y(c.o)} L${x} ${y(c.o)}`);
      target.push(`M${x} ${y(c.c)} L${r(x + half)} ${y(c.c)}`);
    }
  }
  return { up: up.join(" "), down: down.join(" ") };
}
