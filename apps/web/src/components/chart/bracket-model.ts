import type { TradeView } from "@asm/contracts";
import { cfdOpenPnl } from "@/components/trade/pnl-display";

export type BracketKind = "stopLoss" | "takeProfit";
export type BracketLevels = Record<BracketKind, number | null>;
export const BRACKET_KINDS: readonly BracketKind[] = ["takeProfit", "stopLoss"];
export const BRACKET_LABEL = { stopLoss: "SL", takeProfit: "TP" } as const;

export function savedBrackets(trade: TradeView): BracketLevels {
  return { stopLoss: trade.stopLoss ?? null, takeProfit: trade.takeProfit ?? null };
}
export function bracketChanges(saved: BracketLevels, next: BracketLevels): Partial<BracketLevels> {
  const changes: Partial<BracketLevels> = {};
  for (const key of BRACKET_KINDS) if (saved[key] !== next[key]) changes[key] = next[key];
  return changes;
}
export function snapBracketPrice(price: number, tickSize: number, precision: number): number {
  const tick = Math.max(tickSize, 10 ** -precision);
  return Number((Math.round(price / tick) * tick).toFixed(precision));
}
export function bracketError(kind: BracketKind, value: number | null, direction: TradeView["direction"], current: number | null): string | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value <= 0) return "Enter a price greater than zero.";
  if (current === null || current <= 0) return "Waiting for a live price.";
  const below = (kind === "stopLoss") === (direction === "UP");
  if (below ? value >= current : value <= current) return `${BRACKET_LABEL[kind]} must be ${below ? "below" : "above"} the current price (${current}).`;
  return null;
}
export function defaultBracketPrice(kind: BracketKind, trade: TradeView, current: number, priceSpan: number, tick: number, precision: number): number {
  const below = (kind === "stopLoss") === (trade.direction === "UP");
  const distance = Math.max(priceSpan * .18, current * .00025, tick * 5);
  let price = current + (below ? -distance : distance);
  if (kind === "takeProfit") {
    const breakeven = trade.entryPrice * (1 + (trade.direction === "UP" ? 1 : -1) * (trade.spreadFee ?? 0) / trade.stake);
    price = trade.direction === "UP" ? Math.max(price, breakeven + distance) : Math.min(price, breakeven - distance);
  }
  return snapBracketPrice(Math.max(tick, price), tick, precision);
}
export function bracketFromPnl(trade: TradeView, netMinor: number, tick: number, precision: number): number {
  const move = (netMinor + (trade.spreadFee ?? 0)) / trade.stake;
  return snapBracketPrice(trade.entryPrice * (1 + (trade.direction === "UP" ? move : -move)), tick, precision);
}
export function bracketPnl(trade: TradeView, price: number): number { return cfdOpenPnl(trade, price) ?? 0; }
