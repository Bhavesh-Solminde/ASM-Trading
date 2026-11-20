import type { OpenTradeResult, OtcOpenTradeInput, TradeOpenRejectedMessage, TradeOpenResultMessage } from "@asm/contracts";

/**
 * How long a trade sent over the socket may go unanswered before it is retried over HTTP. A displayed
 * price is honoured for 5 s (engine DisplayQuotes), so the retry must still arrive inside that window.
 */
export const SOCKET_TRADE_TIMEOUT_MS = 2_500;

export type PlacedTrade =
  | { ok: true; result: OpenTradeResult; viaSocket: boolean }
  /** `status` follows HTTP: below 500 the request was refused for good and a retry needs a new key; 0 is no answer. */
  | { ok: false; status: number; error: string };

export interface SocketTradeChannel {
  /** The engine socket is open and authenticated. */
  open: boolean;
  /** Sends trade:open and resolves with the engine's reply, or null if none arrives in time. */
  request(order: OtcOpenTradeInput, timeoutMs: number): Promise<TradeOpenResultMessage | TradeOpenRejectedMessage | null>;
}

async function postTrade(order: OtcOpenTradeInput): Promise<PlacedTrade> {
  const res = await fetch("/api/trades", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(order),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<OpenTradeResult> & { error?: string };
  return res.ok && data.trade && data.balances
    ? { ok: true, result: { trade: data.trade, balances: data.balances }, viaSocket: false }
    : { ok: false, status: res.status, error: data.error ?? "Could not place that trade." };
}

/**
 * Opens a fixed OTC trade over the engine socket when it is up: no new connection and no hop through
 * the web server. Otherwise, or when the socket gives no answer or the engine failed internally, it
 * posts the same order to /api/trades. The idempotency key makes that retry return the same trade
 * rather than a second one. A definite refusal over the socket is final.
 */
export async function placeOtcOrder(
  order: OtcOpenTradeInput,
  socket: SocketTradeChannel,
  post: (order: OtcOpenTradeInput) => Promise<PlacedTrade> = postTrade,
): Promise<PlacedTrade> {
  try {
    if (socket.open) {
      const reply = await socket.request(order, SOCKET_TRADE_TIMEOUT_MS);
      if (reply?.type === "trade:open:result") {
        return { ok: true, result: { trade: reply.trade, balances: reply.balances }, viaSocket: true };
      }
      if (reply && reply.code !== "trading_unavailable") return { ok: false, status: 409, error: reply.error };
    }
    return await post(order);
  } catch {
    return { ok: false, status: 0, error: "Could not reach the server." };
  }
}
