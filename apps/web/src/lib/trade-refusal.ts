/** What the ticket says while it reloads after the server refused a stake typed for the wrong currency. */
export const STALE_CURRENCY_NOTICE = "This account was switched to another currency elsewhere. No trade was placed. Reloading so you see the new balance...";

/**
 * True when POST /api/trades refused because the account's currency is no longer the one the ticket sent (409 with
 * code `currency_changed`). The page holds the old currency in server-rendered props, so it must reload to learn the
 * new one; the stake is never resent, since it was typed for the old currency.
 */
export function isStaleCurrencyRefusal(status: number, body: unknown): boolean {
  return status === 409 && typeof body === "object" && body !== null && (body as { code?: unknown }).code === "currency_changed";
}
