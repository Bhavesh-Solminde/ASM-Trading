import { closedRowDisplay } from "@asm/client-core";
import { money } from "@/money/format";
import type { TradeView } from "@asm/contracts";

export interface SettledFeedback {
  tone: "up" | "down" | "neutral";
  key: "trade.won" | "trade.lost" | "trade.refunded";
  /**
   * The figure the trades list shows (`closedRowDisplay`): gross return on a win, stake on a loss. The exception is
   * a refund, where the list shows zero and this is the stake that came back.
   */
  amountMinor: number;
  /** `amountMinor` formatted in the account currency (Latin digits in both languages). */
  amountText: string;
  haptic: "success" | "warning" | null;
}

/**
 * What to tell the trader about a settled trade. Pure; the toast and the haptic are applied by the caller.
 * Win and loss use the trades-list figure (`closedRowDisplay`). The one exception is a refund: the list shows a
 * signless zero for it, but "Refunded ₹0.00" would be false in a toast, so it states the stake that came back.
 */
export function settledFeedback(trade: TradeView, currency: string): SettledFeedback {
  const { amountMinor: listed } = closedRowDisplay(trade);
  const amountMinor = trade.status === "REFUNDED" ? trade.stake : listed;
  const amountText = money(amountMinor, currency);
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

/** Bound on the remembered ids; the oldest are forgotten first. */
const MAX_SEEN = 200;

/**
 * The settlement a `lastSettled` change introduced, or null if it did not change to a (different) trade.
 * Used with an imperative store subscription, which is called once per update, so two settlements that land
 * before React renders are both seen (a hook reading `lastSettled` during render would only see the second).
 */
export function newlySettled(prev: TradeView | null, next: TradeView | null): TradeView | null {
  return next !== null && next !== prev ? next : null;
}

/**
 * Decides whether this settlement should be announced, and records it so it never is twice.
 *
 * Only settlements this device watched happen reach this (socket-delivered, or recovered by a refetch for a trade it
 * held open), so no clock check is needed and a skewed device clock cannot silence the toasts. Like the web app, only trades on the SELECTED
 * account are announced. Every settled trade is recorded the first time it is seen, announced or not, so switching
 * to another account later does not replay its old result.
 */
export function claimAnnouncement(seen: Set<string>, trade: TradeView, ctx: { accountId: string | null }): boolean {
  if (trade.status === "OPEN" || seen.has(trade.id)) return false;
  seen.add(trade.id);
  if (seen.size > MAX_SEEN) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
  return ctx.accountId !== null && trade.accountId === ctx.accountId;
}

/**
 * The settlements to announce for one store update, in order: every trade of a newly published `recovered` batch
 * (a refetch found the socket's push was lost), then a newly delivered `lastSettled`. Both go through
 * `claimAnnouncement` with the same `seen` set, so a trade is announced once however it arrives.
 */
export function toAnnounce(
  prev: { lastSettled: TradeView | null; recovered: readonly TradeView[] },
  next: { lastSettled: TradeView | null; recovered: readonly TradeView[] },
  seen: Set<string>,
  ctx: { accountId: string | null },
): TradeView[] {
  const candidates: TradeView[] = next.recovered !== prev.recovered ? [...next.recovered] : [];
  const live = newlySettled(prev.lastSettled, next.lastSettled);
  if (live) candidates.push(live);
  return candidates.filter((t) => claimAnnouncement(seen, t, ctx));
}
