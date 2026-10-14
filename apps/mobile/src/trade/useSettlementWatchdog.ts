import { useEffect, useRef } from "react";
import { queryClient } from "@/api/queries";
import { refreshBootstrap } from "@/api/refresh-bootstrap";
import { useSocket } from "@/socket/socket-store";
import { allTrades } from "./open-trades";
import { createGapTracker, shouldRefetchSettlements } from "./settlement-watch";

/**
 * Recovers settlements the socket never delivered. `trade:settled` is pushed once and never replayed, so a lost
 * one would leave a trade open at 0:00 for good. Two triggers refetch the bootstrap (its merge lets a settled
 * trade beat an open one): any open trade, on any account, still open past its expiry (checked each second, and
 * only while something is open), and the socket coming back after a drop. Coming back to the foreground is
 * handled by the tab layout.
 */
export function useSettlementWatchdog(hasOpenTrades: boolean): void {
  const lastAttemptSec = useRef<number | null>(null);

  useEffect(() => {
    if (!hasOpenTrades) return;
    const id = setInterval(() => {
      const nowSec = Math.floor(Date.now() / 1000);
      const trades = allTrades(useSocket.getState().trades.tradesByAccount);
      if (!shouldRefetchSettlements({ trades, nowSec, lastAttemptSec: lastAttemptSec.current })) return;
      lastAttemptSec.current = nowSec;
      refreshBootstrap(queryClient);
    }, 1000);
    return () => clearInterval(id);
  }, [hasOpenTrades]);

  useEffect(() => {
    const gap = createGapTracker();
    gap(useSocket.getState().phase);
    return useSocket.subscribe((s, prev) => {
      if (s.phase !== prev.phase && gap(s.phase)) refreshBootstrap(queryClient);
    });
  }, []);
}
