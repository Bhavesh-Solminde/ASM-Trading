import { describe, expect, it } from "vitest";
import type { TradeView } from "@asm/contracts";
import { bracketChanges, bracketError, bracketFromPnl, bracketPnl, defaultBracketPrice, savedBrackets, snapBracketPrice } from "./bracket-model";

const trade: TradeView = { id: "position", accountId: "demo", symbol: "BTCUSDT", direction: "UP", stake: 100000, spreadFee: 50, entryPrice: 80000, entryTs: 0, expiryTs: 300, exitPrice: null, payoutPct: 0, durationSec: 300, status: "OPEN", pnl: 0, stopLoss: 79000, takeProfit: 82000 };

describe("chart bracket drafts", () => {
  it("patches only the edited protection, retaining an untouched server bracket", () => {
    const base = savedBrackets(trade);
    expect(bracketChanges(base, { ...base, stopLoss: 79500 })).toEqual({ stopLoss: 79500 });
    expect(trade.stopLoss).toBe(79000);
    expect(bracketChanges(base, { ...base, takeProfit: null })).toEqual({ takeProfit: null });
    expect(bracketChanges(base, base)).toEqual({});
  });
  it("snaps prices to asset ticks, including fractional index ticks and FX", () => {
    expect(snapBracketPrice(21000.38, .25, 2)).toBe(21000.5);
    expect(snapBracketPrice(1.1234567, .00001, 5)).toBe(1.12346);
    expect(snapBracketPrice(81640.1749, .01, 2)).toBe(81640.17);
  });
  it("validates against the market rather than forbidding a profit-locking stop", () => {
    expect(bracketError("stopLoss", 81000, "UP", 81500)).toBeNull();
    expect(bracketError("stopLoss", 82000, "UP", 81500)).toContain("below");
    expect(bracketError("takeProfit", 81000, "UP", 81500)).toContain("above");
    expect(bracketError("stopLoss", 81000, "DOWN", 80000)).toBeNull();
    expect(bracketError("takeProfit", 79000, "DOWN", 80000)).toBeNull();
    expect(bracketError("takeProfit", 81000, "DOWN", 80000)).toContain("below");
    expect(bracketError("stopLoss", 81000, "UP", null)).toContain("Waiting");
    expect(bracketError("stopLoss", NaN, "UP", 80000)).toContain("greater than zero");
    expect(bracketError("stopLoss", null, "UP", null)).toBeNull();
  });
  it.each(["UP", "DOWN"] as const)("round-trips money ↔ price through the displayed-PnL formula for %s", direction => {
    const t = { ...trade, direction };
    const target = bracketFromPnl(t, 1200, .01, 2);
    const stop = bracketFromPnl(t, -500, .01, 2);
    expect(bracketPnl(t, target)).toBe(1200);
    expect(bracketPnl(t, stop)).toBe(-500);
  });
  it.each(["UP", "DOWN"] as const)("creates visible, correctly sided default brackets for %s", direction => {
    const t = { ...trade, direction };
    for (const kind of ["takeProfit", "stopLoss"] as const) {
      const price = defaultBracketPrice(kind, t, 80000, 300, .01, 2);
      expect(bracketError(kind, price, direction, 80000)).toBeNull();
      expect(Math.abs(price - 80000)).toBeLessThan(100);
    }
  });
});

it("keeps a default TP beyond net breakeven after a losing market move", () => {
  for (const direction of ["UP", "DOWN"] as const) {
    const t = { ...trade, direction };
    const current = direction === "UP" ? 79000 : 81000;
    const target = defaultBracketPrice("takeProfit", t, current, 300, .01, 2);
    expect(bracketPnl(t, target)).toBeGreaterThan(0);
    expect(bracketError("takeProfit", target, direction, current)).toBeNull();
  }
});
