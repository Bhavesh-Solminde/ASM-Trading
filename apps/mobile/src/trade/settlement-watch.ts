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
 * settlements may have been pushed into the gap. The first authentication of a session is not a gap (the
 * bootstrap request is already running), nor is a failed first connect.
 */
export function createGapTracker(): (phase: SocketStatus["phase"]) => boolean {
  let wasAuthed = false;
  let dropped = false;
  return (phase) => {
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
