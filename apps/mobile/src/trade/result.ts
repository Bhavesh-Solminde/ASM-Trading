import { closedRowDisplay, formatMinor } from "@asm/client-core";
import type { TradeView } from "@asm/contracts";

export interface SettledFeedback {
  tone: "up" | "down" | "neutral";
  key: "trade.won" | "trade.lost" | "trade.refunded";
  /** Same figure the trades list shows for this trade (`closedRowDisplay`): gross return on a win, stake on a loss. */
  amountMinor: number;
  /** `amountMinor` formatted in the account currency (Latin digits in both languages). */
  amountText: string;
  haptic: "success" | "warning" | null;
}

/** What to tell the trader about a settled trade. Pure; the toast and the haptic are applied by the caller. */
export function settledFeedback(trade: TradeView, currency: string): SettledFeedback {
  const { amountMinor } = closedRowDisplay(trade);
  const amountText = formatMinor(amountMinor, currency);
  switch (trade.status) {
    case "WON":
      return { tone: "up", key: "trade.won", amountMinor, amountText, haptic: "success" };
    case "REFUNDED":
      return { tone: "neutral", key: "trade.refunded", amountMinor, amountText, haptic: null };
    default:
      // LOST (and OPEN, which is never announced) read as a loss of the stake.
      return { tone: "down", key: "trade.lost", amountMinor, amountText, haptic: "warning" };
  }
}

/**
 * Only a settlement that expired this recently is announced. `trade:settled` is pushed once and never replayed,
 * so anything older arrived late (or was re-read from the store on a remount) and a toast would be confusing.
 * Settlements that happened while the app was in the background are delivered by the bootstrap refetch, which
 * does not go through `lastSettled`, so they are deliberately never announced.
 */
export const ANNOUNCE_WINDOW_SEC = 60;

/** Bound on the remembered ids; the oldest are forgotten first. */
const MAX_SEEN = 200;

/**
 * Decides whether this settlement should be announced, and records it so it never is twice.
 *
 * Like the web app, only trades on the SELECTED account are announced. Every settled trade is recorded the first
 * time it is seen, announced or not, so switching to another account later does not replay its old result.
 * A device clock behind the server is tolerated (a negative age counts as fresh); one ahead by more than the
 * window silently loses the toast, never the trade.
 */
export function claimAnnouncement(
  seen: Set<string>,
  trade: TradeView,
  ctx: { accountId: string | null; nowSec: number },
): boolean {
  if (trade.status === "OPEN" || seen.has(trade.id)) return false;
  seen.add(trade.id);
  if (seen.size > MAX_SEEN) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
  if (ctx.accountId === null || trade.accountId !== ctx.accountId) return false;
  return ctx.nowSec - trade.expiryTs <= ANNOUNCE_WINDOW_SEC;
}
