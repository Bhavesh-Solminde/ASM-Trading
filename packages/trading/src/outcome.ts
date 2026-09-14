export type Direction = "UP" | "DOWN";
export type Outcome = "WON" | "LOST" | "REFUNDED";

/**
 * A binary option settles on a strict comparison against the entry price.
 * An exact tie is a refund, not a loss — counting it as a loss would bias every
 * win-rate estimate downward and is a classic silent error.
 */
export function didWin(
  direction: Direction,
  entryPrice: number,
  exitPrice: number,
): Outcome {
  if (exitPrice === entryPrice) return "REFUNDED";
  const rose = exitPrice > entryPrice;
  const won = direction === "UP" ? rose : !rose;
  return won ? "WON" : "LOST";
}

/**
 * What lands back in the account, in minor units.
 * Profit floors rather than rounds, so sub-unit remainders favour the house —
 * one deterministic rounding boundary, always in the same direction.
 */
export function settlementCredit(
  stake: number,
  payoutPct: number,
  outcome: Outcome,
): number {
  if (!Number.isInteger(stake) || stake <= 0) {
    throw new Error(`stake must be a positive integer, received ${stake}`);
  }
  switch (outcome) {
    case "WON":
      return stake + Math.floor((stake * payoutPct) / 100);
    case "REFUNDED":
      return stake;
    case "LOST":
      return 0;
  }
}

/** Signed profit or loss, in minor units. */
export function settlementPnl(
  stake: number,
  payoutPct: number,
  outcome: Outcome,
): number {
  switch (outcome) {
    case "WON":
      return Math.floor((stake * payoutPct) / 100);
    case "REFUNDED":
      return 0;
    case "LOST":
      return -stake;
  }
}
