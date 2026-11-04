import { useEffect, useRef } from "react";
import type { Bootstrap } from "@asm/contracts";
import { queryClient } from "@/api/queries";
import { refreshBootstrap } from "@/api/refresh-bootstrap";
import { useSocket } from "@/socket/socket-store";
import { bootstrapTradesAccountId } from "./accounts";
import { fetchAccountTrades } from "./fetch-account-trades";
import { allTrades } from "./open-trades";
import { createGapTracker, needsBalanceFollowUp, runWatchdogTick } from "./settlement-watch";

/**
 * Recovers settlements the socket never delivered. `trade:settled` is pushed once and never replayed, so a lost
 * one would leave a trade open at 0:00 for good. Two triggers refetch the bootstrap (its merge lets a settled
 * trade beat an open one): any open trade, on any account, still open past its expiry (checked each second, and
 * only while something is open), and the socket coming back after a drop. Bootstrap carries only the default
 * account's trades, so an overdue trade on any other account (LIVE) also refetches that account's own list, as the
 * web does; the store then announces what it recovers. Coming back to the foreground is
 * handled by the tab layout. A third refetches once after a recovered settlement kept a newer stored balance
 * (the response may have predated it), so the balance converges; that refetch recovers nothing, so it cannot repeat.
 */
export function useSettlementWatchdog(hasOpenTrades: boolean): void {
  const lastAttemptSec = useRef<number | null>(null);

  useEffect(() => {
    if (!hasOpenTrades) return;
    const id = setInterval(() => {
      const boot = queryClient.getQueryData<Bootstrap>(["bootstrap"]);
      lastAttemptSec.current = runWatchdogTick({
        trades: allTrades(useSocket.getState().trades.tradesByAccount),
        nowSec: Math.floor(Date.now() / 1000),
        lastAttemptSec: lastAttemptSec.current,
        bootstrapAccountId: boot ? bootstrapTradesAccountId(boot.accounts) : undefined,
        refreshBootstrap: () => refreshBootstrap(queryClient),
        // A failed fetch is retried by the next tick (past the throttle), so the error is not surfaced.
        fetchTrades: (accountId) => void fetchAccountTrades(accountId).catch(() => {}),
      });
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

  useEffect(
    () =>
      useSocket.subscribe((s, prev) => {
        if (needsBalanceFollowUp(prev.balanceRefetch, s.balanceRefetch)) refreshBootstrap(queryClient);
      }),
    [],
  );
}
