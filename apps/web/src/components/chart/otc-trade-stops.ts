import type { OtcSetStopsInput, TradeView } from "@asm/contracts";
import { snapBracketPrice } from "./bracket-model";

export type TradeStops = Pick<OtcSetStopsInput, "stopLoss" | "takeProfit">;
type Entry = Pick<TradeView, "entryPrice" | "direction">;
export type StopKind = keyof TradeStops;
export const STOP_KINDS = ["stopLoss", "takeProfit"] as const;
export const EMPTY_STOPS: TradeStops = { stopLoss: null, takeProfit: null };

export function hasStops(levels: TradeStops) {
  return levels.stopLoss !== null || levels.takeProfit !== null;
}

export function sameStops(a: TradeStops, b: TradeStops) {
  return a.stopLoss === b.stopLoss && a.takeProfit === b.takeProfit;
}

/** Snap to the tick grid and stay strictly outside both the entry and live price. */
export function clampStopLevel(kind: StopKind, price: number, trade: Entry, live: number, tickSize: number, precision: number) {
  const below = (kind === "stopLoss") === (trade.direction === "UP");
  const bound = below ? Math.min(trade.entryPrice, live) : Math.max(trade.entryPrice, live);
  const tick = Math.max(tickSize, 10 ** -precision);
  const snap = (value: number) => snapBracketPrice(value, tick, precision);
  const nearest = snap(bound);
  const edge = below ? (nearest < bound ? nearest : snap(nearest - tick)) : (nearest > bound ? nearest : snap(nearest + tick));
  const level = below ? Math.min(snap(Math.max(tick, price)), edge) : Math.max(snap(price), edge);
  return Number.isFinite(level) && level > 0 ? level : null;
}

export function defaultStopLevels(trade: Entry, live: number, tickSize: number, precision: number, chartSpan: number | null): TradeStops {
  const distance = Math.max(tickSize * 10, chartSpan === null ? live * .001 : chartSpan * .3);
  const up = trade.direction === "UP";
  return {
    stopLoss: clampStopLevel("stopLoss", live + (up ? -distance : distance), trade, live, tickSize, precision),
    takeProfit: clampStopLevel("takeProfit", live + (up ? distance : -distance), trade, live, tickSize, precision),
  };
}
