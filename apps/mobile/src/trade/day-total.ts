import type { TradeView } from "@asm/contracts";

const DAY_MS = 86_400_000;
/** India has no daylight saving: IST is always UTC+05:30 (no Intl time zone support needed on Hermes). */
const IST_OFFSET_MS = 19_800_000;
/** The page size of bootstrap's `recentTrades`, `GET /api/trades` and the client store: a full page may be cut short. */
export const TRADE_PAGE_SIZE = 50;

export function istDayStartMs(nowMs: number): number {
  return Math.floor((nowMs + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
}

/**
 * Net P&L (sum of `pnl`: profit on a win, -stake on a loss, 0 on a refund) of the trades that settled today
 * (IST). Null when none settled today, so the header line hides instead of showing a misleading 0.
 *
 * The device only ever holds the account's last 50 trades, so the figure is shown only when that list provably
 * covers the whole IST day: it has fewer than 50 rows (the account has no more), or its oldest `expiryTs` is
 * before today's midnight (anything older than that row is not today's). A full page that is still inside today
 * could be missing earlier trades: null, never a plausible-looking wrong number.
 */
export function dayNetMinor(trades: readonly TradeView[], nowMs: number): number | null {
  const from = istDayStartMs(nowMs) / 1000;
  const to = from + DAY_MS / 1000;
  if (trades.length >= TRADE_PAGE_SIZE && Math.min(...trades.map((t) => t.expiryTs)) >= from) return null;
  let net = 0;
  let any = false;
  for (const t of trades) {
    if (t.status === "OPEN" || t.expiryTs < from || t.expiryTs >= to) continue;
    net += t.pnl;
    any = true;
  }
  return any ? net : null;
}

/**
 * Today's net for ONE account's list. `listLoaded` is false while that list is not known to be complete (a
 * non-default account whose `GET /api/trades` is still in flight or failed): hidden, because until then the store
 * holds only what the socket delivered this session, a partial sum that would read as the real figure.
 * Every place that shows "today" goes through this, so the top bar and the trades sheet cannot disagree.
 */
export function dayNetForList(list: readonly TradeView[] | undefined, listLoaded: boolean, nowMs: number): number | null {
  if (!listLoaded || !list) return null;
  return dayNetMinor(list, nowMs);
}

/** `dayNetForList` for the account `accountId` out of the store's per-account lists. */
export function dayNetForAccount(
  tradesByAccount: Readonly<Record<string, readonly TradeView[]>>,
  accountId: string,
  listLoaded: boolean,
  nowMs: number,
): number | null {
  return dayNetForList(tradesByAccount[accountId], listLoaded, nowMs);
}
