/** Campaign boundaries are absolute instants; the end is midnight in India. */
export const DIWALI_START = Date.parse("2026-11-08T00:00:00+05:30");
export const DIWALI_END = Date.parse("2026-11-13T00:00:00+05:30");
export const DIWALI_SEEN_KEY = "indianxtrade:diwali:2026:seen";

export function isDiwali(now = Date.now()) {
  return now >= DIWALI_START && now < DIWALI_END;
}

export function isCelebratedWin(trade: { status: string; pnl: number }) {
  return (trade.status === "WON" || trade.status === "CLOSED") && trade.pnl > 0;
}

/** An allowlist prevents seasonal overlays on money movement and verification. */
export function diwaliRouteAllowed(pathname: string) {
  return pathname === "/" || /^\/(trade|history|leaderboard|support|referral|balance)(\/|$)/.test(pathname)
    || pathname === "/account" || /^\/account\/(profile|demo|currency)(\/|$)/.test(pathname);
}

export const FIREWORK_BURSTS = [
  { delay: 0.4, x: "18%", y: "27%" },
  { delay: 0.85, x: "80%", y: "38%" },
  { delay: 1.3, x: "50%", y: "18%" },
] as const;
