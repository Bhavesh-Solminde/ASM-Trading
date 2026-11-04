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

/** How long past its expiry an unsettled trade still holds the screen awake. A lost settlement must not do so forever. */
export const AWAKE_GRACE_SEC = 120;

/**
 * Epoch second until which the screen should stay awake for the open trades (all accounts): the latest expiry plus
 * the grace, or null when nothing is open. Pure, so the give-up rule is tested without timers.
 */
export function awakeDeadlineSec(byAccount: TradesByAccount): number | null {
  let latest: number | null = null;
  for (const list of Object.values(byAccount)) {
    for (const t of list) {
      if (t.status === "OPEN" && (latest === null || t.expiryTs > latest)) latest = t.expiryTs;
    }
  }
  return latest === null ? null : latest + AWAKE_GRACE_SEC;
}
