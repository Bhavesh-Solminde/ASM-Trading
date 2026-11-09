import { istDayStartMs } from "./day-total";

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 19_800_000;
/** The nightly close the engine enforces for the India indices: 23:30 IST until 05:00 IST (packages/algo schedule). */
const CLOSE_MIN = 23 * 60 + 30;
const OPEN_MIN = 5 * 60;
/** Mirrors `INDIA_MARKET_SYMBOLS` in @asm/algo (server-only, not bundled into the app). Crypto and forex never close. */
const NIGHTLY_CLOSE_SYMBOLS: ReadonlySet<string> = new Set(["NIFTY50", "BANKNIFTY", "FINNIFTY", "SENSEX", "NIFTYIT", "NIFTYMIDCAP100"]);

/**
 * When a market in its nightly close opens again (epoch ms), or null while it is open. Display only: the
 * engine stays the authority and still refuses a trade with `market_closed`.
 */
export function marketReopensAt(symbol: string, nowMs: number): number | null {
  if (!NIGHTLY_CLOSE_SYMBOLS.has(symbol)) return null;
  const minuteOfDay = Math.floor((((nowMs + IST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS / MIN_MS);
  if (minuteOfDay >= OPEN_MIN && minuteOfDay < CLOSE_MIN) return null;
  const open = istDayStartMs(nowMs) + OPEN_MIN * MIN_MS;
  return minuteOfDay >= CLOSE_MIN ? open + DAY_MS : open;
}

/** Device-local "HH:MM" (the ledger and the lock screen read the same clock). */
export function clockHm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
