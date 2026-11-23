import type { OtcSetStopsInput, TradeView } from "@asm/contracts";

export const STOP_SIDES = ["stopLoss", "takeProfit"] as const;
export type StopSide = (typeof STOP_SIDES)[number];
export type StopLevels = Pick<OtcSetStopsInput, StopSide>;

export const EMPTY_STOPS: StopLevels = { stopLoss: null, takeProfit: null };

export function stopLevels(trade: TradeView): StopLevels {
  return { stopLoss: trade.stopLoss ?? null, takeProfit: trade.takeProfit ?? null };
}

export function hasStops(levels: StopLevels): boolean {
  return levels.stopLoss !== null || levels.takeProfit !== null;
}

export function sameStops(a: StopLevels, b: StopLevels): boolean {
  return a.stopLoss === b.stopLoss && a.takeProfit === b.takeProfit;
}

export function canEditStops(trade: TradeView, nowMs: number): boolean {
  return trade.mode === "OTC_FIXED" && !trade.pending && trade.status === "OPEN" && nowMs < trade.expiryTs * 1000;
}

/** Focus an eligible position on this chart. A finished position gives way to the newest open one. */
export function focusedStopTrade(trades: readonly TradeView[], selectedId: string | null, nowMs: number): TradeView | undefined {
  let newest: TradeView | undefined;
  for (const trade of trades) {
    if (!canEditStops(trade, nowMs)) continue;
    if (trade.id === selectedId) return trade;
    if (!newest || trade.entryTs > newest.entryTs) newest = trade;
  }
  return newest;
}

function clampStop(
  value: number | null,
  side: StopSide,
  trade: Pick<TradeView, "entryPrice" | "direction">,
  price: number,
  precision: number,
): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const step = 10 ** -precision;
  const below = (trade.direction === "UP") === (side === "stopLoss");
  const boundary = below ? Math.min(trade.entryPrice, price) : Math.max(trade.entryPrice, price);
  const round = (n: number) => Number(n.toFixed(precision));
  let level = round(below ? Math.min(Math.max(step, value), boundary) : Math.max(value, boundary));
  if (below ? level >= boundary : level <= boundary) level = round(level + (below ? -step : step));
  return Number.isFinite(level) && level > 0 && (below ? level < boundary : level > boundary) ? level : null;
}

export function clampStops(
  levels: StopLevels,
  trade: Pick<TradeView, "entryPrice" | "direction">,
  price: number,
  precision: number,
): StopLevels {
  return {
    stopLoss: clampStop(levels.stopLoss, "stopLoss", trade, price, precision),
    takeProfit: clampStop(levels.takeProfit, "takeProfit", trade, price, precision),
  };
}

export function initialStops(trade: Pick<TradeView, "entryPrice" | "direction">, price: number, precision: number): StopLevels {
  const gap = Math.max(price * 0.0015, 10 ** -precision * 5);
  const sign = trade.direction === "UP" ? 1 : -1;
  return clampStops({ stopLoss: price - sign * gap, takeProfit: price + sign * gap }, trade, price, precision);
}
