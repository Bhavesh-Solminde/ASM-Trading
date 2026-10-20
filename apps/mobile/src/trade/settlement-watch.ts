import { shouldReconcile } from "@asm/client-core";
import type { TradeView } from "@asm/contracts";
import type { SocketStatus } from "@/socket/engine-socket";

/**
 * Floor between watchdog refetches. A refetch here is the whole bootstrap (heavier than the web's per-account
 * trades call, which uses 5s), and an engine that abandoned a settlement leaves the row open forever.
 */
export const WATCHDOG_MIN_INTERVAL_SEC = 10;

/**
 * Whether to re-read the server because an open trade is past its expiry, which means `trade:settled` was lost
 * (socket down at the expiry second, message dropped). Same rule as the web watchdog, with a bootstrap-sized floor.
 */
export function shouldRefetchSettlements(input: {
  trades: readonly TradeView[];
  nowSec: number;
  lastAttemptSec: number | null;
}): boolean {
  return shouldReconcile({ ...input, minIntervalSec: WATCHDOG_MIN_INTERVAL_SEC });
}

/**
 * Feed it each socket phase in order; it answers true when `authed` comes back after the connection dropped, i.e.
 * settlements may have been pushed into the gap. Not a gap: the first authentication of a session (the bootstrap
 * request is already running), a failed first connect, and a restart after a deliberate stop (`idle`).
 */
export function createGapTracker(): (phase: SocketStatus["phase"]) => boolean {
  let wasAuthed = false;
  let dropped = false;
  return (phase) => {
    if (phase === "idle") {
      // A deliberate stop (app backgrounded, signed out): coming back is a restart, which the foreground
      // refresh already covers, not a drop.
      wasAuthed = false;
      dropped = false;
      return false;
    }
    if (phase === "authed") {
      const fire = dropped;
      wasAuthed = true;
      dropped = false;
      return fire;
    }
    if (wasAuthed) dropped = true;
    return false;
  };
}

/**
 * Whether the store just published a new batch of accounts whose recovered settlement kept a newer balance: then
 * one more bootstrap is requested so the balance converges. Identity-based, so each batch triggers exactly once.
 */
export function needsBalanceFollowUp(prev: readonly string[], next: readonly string[]): boolean {
  return next !== prev && next.length > 0;
}

/**
 * Accounts with an overdue open trade that the bootstrap's `recentTrades` does NOT carry (it holds only the DEMO
 * account's list, see `bootstrapTradesAccountId`). A bootstrap refetch can never settle those, so each needs its own
 * `GET /api/trades?accountId=` (the web watchdog refetches the active account's list the same way). Same overdue
 * rule as `shouldRefetchSettlements`; each account once, in order of first appearance. While the bootstrap account
 * is unknown every account counts as uncarried.
 */
export function accountsNeedingTradeFetch(input: {
  trades: readonly TradeView[];
  nowSec: number;
  bootstrapAccountId: string | undefined;
}): string[] {
  const out: string[] = [];
  for (const t of input.trades) {
    if (t.accountId === input.bootstrapAccountId || out.includes(t.accountId)) continue;
    if (shouldReconcile({ trades: [t], nowSec: input.nowSec, lastAttemptSec: null })) out.push(t.accountId);
  }
  return out;
}

/**
 * One watchdog check. Past the throttle with something overdue it refetches the bootstrap (the default account's
 * trades, and every account's balance) and, for every other account holding an overdue trade, that account's own
 * trade list. Returns the new "last attempt" (unchanged when it did nothing).
 */
export function runWatchdogTick(input: {
  trades: readonly TradeView[];
  nowSec: number;
  lastAttemptSec: number | null;
  bootstrapAccountId: string | undefined;
  refreshBootstrap: () => void;
  fetchTrades: (accountId: string) => void;
}): number | null {
  const { trades, nowSec, lastAttemptSec } = input;
  if (!shouldRefetchSettlements({ trades, nowSec, lastAttemptSec })) return lastAttemptSec;
  input.refreshBootstrap();
  for (const accountId of accountsNeedingTradeFetch({ trades, nowSec, bootstrapAccountId: input.bootstrapAccountId })) {
    input.fetchTrades(accountId);
  }
  return nowSec;
}
