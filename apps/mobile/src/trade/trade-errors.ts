import { minStakeMinor } from "@asm/client-core";
import { ApiError } from "@/api/errors";
import { money } from "@/money/format";

/** Server refusal codes (the web trade route passes the engine's reason through as `code`) with translated copy. */
const KEYS: Record<string, string> = {
  insufficient_funds: "trade.insufficient",
  market_closed: "trade.marketClosed",
  account_not_active: "trade.accountPaused",
  unknown_asset: "trade.assetUnavailable",
  trading_unavailable: "trade.unavailable",
  // The request got no answer in time (see `api` timeoutMs); the trade may or may not have been placed.
  timeout: "trade.timedOut",
  // The account was converted (INR <-> USD) after this device last saw it; the stake on screen is in the old currency.
  currency_changed: "trade.currencyChanged",
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

/**
 * The translated toast text for a failed open-trade call. `min_stake` needs the currency's minimum in the copy,
 * so it is built here; every other code goes through `tradeErrorKey`.
 */
export function tradeErrorText(e: unknown, currency: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (e instanceof ApiError && e.code === "min_stake") return t("trade.minStake", { amount: money(minStakeMinor(currency), currency) });
  return t(tradeErrorKey(e));
}
