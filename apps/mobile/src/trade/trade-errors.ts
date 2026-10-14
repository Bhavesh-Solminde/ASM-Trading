import { ApiError } from "@/api/errors";

/** Server refusal codes (the web trade route passes the engine's reason through as `code`) with translated copy. */
const KEYS: Record<string, string> = {
  insufficient_funds: "trade.insufficient",
  market_closed: "trade.marketClosed",
  account_not_active: "trade.accountPaused",
  unknown_asset: "trade.assetUnavailable",
  trading_unavailable: "trade.unavailable",
};

/**
 * The i18n key to toast for a failed open-trade call. The server's own text is English-only, so it is never shown:
 * known codes map to translated copy, everything else is the generic `trade.failed`.
 */
export function tradeErrorKey(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "offline") return "common.noConnection";
    if (e.code !== null && KEYS[e.code] !== undefined) return KEYS[e.code]!;
  }
  return "trade.failed";
}
