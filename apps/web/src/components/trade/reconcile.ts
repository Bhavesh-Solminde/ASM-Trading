import type { TradeView } from "@asm/contracts";

/**
 * Seconds past a trade's expiry we wait before distrusting our own copy of it.
 *
 * Settlement is captured on the expiry tick and persisted by a serialised
 * worker, so `trade:settled` lands a moment after `expiryTs`. The grace window
 * keeps the normal, socket-delivered path from racing a needless fetch.
 */
export const RECONCILE_GRACE_SEC = 3;

/**
 * Floor between reconcile attempts. An engine that abandoned a settlement
 * leaves the row OPEN past its expiry forever (see TradeDesk.drain's
 * `trade.settle_abandoned`); without a floor that row would re-request on
 * every tick of the watchdog.
 */
export const RECONCILE_MIN_INTERVAL_SEC = 5;

/**
 * Whether this account's trades should be re-fetched from the server.
 *
 * A trade runs to its full duration on the engine whether or not its owner is
 * watching — losing the connection at 4s of a 10s trade does not stop the
 * remaining 6s, and the outcome is persisted regardless. What the client can
 * lose is the *news* of it: `trade:settled` is pushed to the owner's live
 * socket and never replayed, so a socket that is down at the settlement second
 * (tab closed, phone backgrounded, network dropped) leaves this tab holding an
 * OPEN trade with a dead countdown — the trade looks like it resumed rather
 * than ended on time. Any OPEN trade still sitting past its expiry means we
 * missed the push, so we go and ask.
 */
export function shouldReconcile(opts: {
  trades: readonly TradeView[];
  nowSec: number;
  /** When we last asked, or null if we never have. */
  lastAttemptSec: number | null;
  graceSec?: number;
  minIntervalSec?: number;
}): boolean {
  const grace = opts.graceSec ?? RECONCILE_GRACE_SEC;
  const minInterval = opts.minIntervalSec ?? RECONCILE_MIN_INTERVAL_SEC;

  if (opts.lastAttemptSec !== null && opts.nowSec - opts.lastAttemptSec < minInterval) {
    return false;
  }
  return opts.trades.some(
    (trade) => trade.status === "OPEN" && opts.nowSec >= trade.expiryTs + grace,
  );
}
