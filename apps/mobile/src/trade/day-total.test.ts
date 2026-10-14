import { describe, expect, it } from "vitest";
import type { TradeView } from "@asm/contracts";
import { dayNetForAccount, dayNetMinor, istDayStartMs } from "./day-total";

const sec = (ms: number) => Math.floor(ms / 1000);
const trade = (id: string, status: TradeView["status"], pnl: number, expiryMs: number, accountId = "a"): TradeView => ({
  id,
  accountId,
  symbol: "BTCUSDT",
  direction: "UP",
  stake: 10_000,
  payoutPct: 93,
  entryPrice: 1,
  entryTs: sec(expiryMs) - 30,
  expiryTs: sec(expiryMs),
  exitPrice: status === "OPEN" ? null : 1.1,
  status,
  pnl,
});

// 14 Oct 2026, 17:30 IST.
const NOW = Date.UTC(2026, 9, 14, 12, 0);
/** A full page of 50 settled rows, newest first, `spacingMs` apart, the newest at `newestMs`. */
const page = (newestMs: number, spacingMs: number, accountId = "a"): TradeView[] =>
  Array.from({ length: 50 }, (_, i) => trade(`p${i}`, "WON", 9_300, newestMs - i * spacingMs, accountId));

describe("istDayStartMs", () => {
  it("is 00:00 IST (18:30 UTC the day before)", () => {
    expect(istDayStartMs(NOW)).toBe(Date.UTC(2026, 9, 13, 18, 30));
  });
});

describe("dayNetMinor", () => {
  it("sums the net P&L of trades settled since 00:00 IST", () => {
    const trades = [
      trade("w", "WON", 9_300, Date.UTC(2026, 9, 14, 10, 0)),
      trade("l1", "LOST", -10_000, Date.UTC(2026, 9, 14, 11, 0)),
      trade("l2", "LOST", -10_000, Date.UTC(2026, 9, 14, 11, 30)),
      trade("w2", "WON", 9_300, Date.UTC(2026, 9, 13, 18, 30)), // exactly 00:00 IST: today
      trade("old", "WON", 9_300, Date.UTC(2026, 9, 13, 18, 29)), // 23:59 IST yesterday
      trade("open", "OPEN", 0, Date.UTC(2026, 9, 14, 12, 1)),
      trade("r", "REFUNDED", 0, Date.UTC(2026, 9, 14, 9, 0)),
    ];
    expect(dayNetMinor(trades, NOW)).toBe(9_300 - 10_000 - 10_000 + 9_300);
  });
  it("is null when nothing settled today", () => {
    expect(dayNetMinor([trade("old", "WON", 9_300, Date.UTC(2026, 9, 12, 10, 0))], NOW)).toBeNull();
    expect(dayNetMinor([], NOW)).toBeNull();
  });

  describe("coverage guard (the list must provably reach back past 00:00 IST)", () => {
    it("is null for a full 50-row list whose oldest row is still today: older trades may be missing", () => {
      // 50 trades one minute apart, all inside today.
      expect(dayNetMinor(page(Date.UTC(2026, 9, 14, 11, 59), 60_000), NOW)).toBeNull();
    });
    it("sums a full 50-row list whose oldest row is before IST midnight", () => {
      // 50 trades 30 minutes apart: the oldest is ~24h earlier, so the list reaches yesterday.
      const trades = page(Date.UTC(2026, 9, 14, 11, 59), 30 * 60_000);
      const today = trades.filter((t) => t.expiryTs >= istDayStartMs(NOW) / 1000);
      expect(today.length).toBeGreaterThan(0);
      expect(today.length).toBeLessThan(50);
      expect(dayNetMinor(trades, NOW)).toBe(today.length * 9_300);
    });
    it("sums a 12-row list: fewer than 50 rows means the account has no more", () => {
      const trades = Array.from({ length: 12 }, (_, i) => trade(`t${i}`, "WON", 9_300, Date.UTC(2026, 9, 14, 11, 0) - i * 60_000));
      expect(dayNetMinor(trades, NOW)).toBe(12 * 9_300);
    });
    it("counts open rows toward the 50 (a full list with open rows is still a full list)", () => {
      const trades = [...page(Date.UTC(2026, 9, 14, 11, 59), 60_000).slice(1), trade("open", "OPEN", 0, Date.UTC(2026, 9, 14, 12, 1))];
      expect(trades).toHaveLength(50);
      expect(dayNetMinor(trades, NOW)).toBeNull();
    });
    it("is null for an empty list", () => {
      expect(dayNetMinor([], NOW)).toBeNull();
    });
  });
});

describe("dayNetForAccount", () => {
  const byAccount = {
    demo: [trade("d1", "WON", 9_300, Date.UTC(2026, 9, 14, 10, 0), "demo")],
    live: [trade("l1", "LOST", -10_000, Date.UTC(2026, 9, 14, 10, 0), "live")],
  };
  it("reads only the selected account's list: a switch never reuses the previous account's figure", () => {
    expect(dayNetForAccount(byAccount, "demo", true, NOW)).toBe(9_300);
    expect(dayNetForAccount(byAccount, "live", true, NOW)).toBe(-10_000);
  });
  it("is null for an account with no list yet", () => {
    expect(dayNetForAccount(byAccount, "other", true, NOW)).toBeNull();
  });
  it("is null while the account's list is not known to be loaded (a fetch in flight)", () => {
    expect(dayNetForAccount(byAccount, "live", false, NOW)).toBeNull();
  });
});
