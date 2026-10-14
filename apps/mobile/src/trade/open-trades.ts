import type { TradeView } from "@asm/contracts";

export type TradesByAccount = Readonly<Record<string, readonly TradeView[]>>;

/** Every account's trades in one list. */
export function allTrades(byAccount: TradesByAccount): TradeView[] {
  return Object.values(byAccount).flat();
}

/** True while ANY account has an open trade: the screen stays awake and settlements are watched for all of them. */
export function hasOpenTrade(byAccount: TradesByAccount): boolean {
  return Object.values(byAccount).some((list) => list.some((t) => t.status === "OPEN"));
}
