import { z } from "zod";
import { api } from "@/api/client";
import { useSession } from "@/auth/session-store";
import { useSocket } from "@/socket/socket-store";

const TradesResponse = z.object({ trades: z.array(z.unknown()) });

/**
 * Fetches one account's last 50 trades (`GET /api/trades?accountId=`) and folds them into the socket store, which
 * publishes any settlement this device held open (`recovered`). Bootstrap carries only the default account's list, so
 * this is the only way to learn a LIVE trade settled when the push was lost.
 *
 * The result is applied only if the session is still the one that asked: a response landing after sign-out (or after
 * another user signed in) belongs to nobody and must not reach the next user's store. Resolves true when applied,
 * false when dropped; rejects when the request fails.
 */
export async function fetchAccountTrades(accountId: string): Promise<boolean> {
  const token = useSession.getState().token;
  const res = await api("/api/trades?accountId=" + encodeURIComponent(accountId), { schema: TradesResponse, silentRateLimit: true });
  if (useSession.getState().token !== token) return false;
  useSocket.getState().mergeFetchedTrades(accountId, res.trades);
  return true;
}
