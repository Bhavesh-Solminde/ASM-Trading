import { useEffect, useState } from "react";
import { z } from "zod";
import { api } from "@/api/client";
import { useSocket } from "@/socket/socket-store";

const TradesResponse = z.object({ trades: z.array(z.unknown()) });

/**
 * Whether `accountId`'s trade list in the store is complete (its last 50 are all there). Bootstrap carries only the
 * default account's list, so for any other account (`needsFetch`) this fetches `GET /api/trades?accountId=` and
 * merges it into the store, and again each time the socket (re)connects (settlements missed while it was closed).
 * False until the first fetch for THIS account lands, and again after a switch, so a figure from the previous
 * account is never shown; false for good if the fetch keeps failing (the caller hides what it cannot prove).
 */
export function useAccountTradesLoaded(accountId: string, needsFetch: boolean): boolean {
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const socketLive = useSocket((s) => s.phase === "authed");
  useEffect(() => {
    if (!needsFetch) return;
    let stale = false;
    api("/api/trades?accountId=" + encodeURIComponent(accountId), { schema: TradesResponse, silentRateLimit: true }).then(
      (res) => {
        if (stale) return;
        useSocket.getState().mergeFetchedTrades(accountId, res.trades);
        setLoadedFor(accountId);
      },
      () => {
        // Offline or the server said no: stay hidden. The next reconnect or account switch tries again.
      },
    );
    return () => {
      stale = true;
    };
  }, [accountId, needsFetch, socketLive]);
  return !needsFetch || loadedFor === accountId;
}
