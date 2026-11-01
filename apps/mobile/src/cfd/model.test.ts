import { describe, expect, it } from "vitest";
import type { CfdTradeView } from "@asm/contracts";
import { cfdChartTrade, cfdNet, mergeCfd, parseCfd, protectionPct } from "./model";
const position: CfdTradeView = { id: "p1", accountId: "a1", symbol: "EURUSD", direction: "LONG", stake: 10000, spreadFee: 500, leverage: 100, entryPrice: 100, entryTs: 10, expiryTs: 310, exitPrice: null, stopLoss: 99.5, takeProfit: 101, trailingPct: null, liqPrice: 99, closeReason: null, status: "OPEN", pnl: 0 };
describe("CFD native lifecycle", () => {
  it("cannot reopen a settled position when the HTTP open arrives after the socket close", () => {
    const closed = { ...position, status: "CLOSED" as const, pnl: 1000, exitPrice: 100.1, closeReason: "MANUAL" as const };
    const book = mergeCfd({}, "a1", [closed]);
    expect(mergeCfd(book, "a1", [position])["a1"]).toEqual([closed]);
  });
  it("restates historic amounts after a currency switch, without retaining old units", () => {
    const closed = { ...position, status: "CLOSED" as const, pnl: 1100 };
    const book = mergeCfd({}, "a1", [closed]);
    const converted = { ...closed, stake: 91, pnl: 10, spreadFee: 5 };
    expect(mergeCfd(book, "a1", [converted])["a1"]?.[0]).toEqual(converted);
  });
  it("separates accounts and skips malformed or binary positions", () => {
    expect(mergeCfd({}, "a2", [position])["a2"]).toEqual([]);
    expect(parseCfd([position, { ...position, direction: "UP", payoutPct: 85 }, { ...position, leverage: -1 }])).toEqual([position]);
  });
  it("uses leveraged variable P/L and subtracts the paid fee once, rather than binary win/loss semantics", () => {
    expect(cfdNet(position, 100.1)).toBe(500);
    expect(cfdNet({ ...position, direction: "SHORT" }, 100.1)).toBe(-1500);
    expect(cfdNet({ ...position, status: "CLOSED", pnl: 1000 }, 1000)).toBe(500);
    expect(cfdNet(position, 105)).toBe(19500); // gross profit capped at 2× investment
    expect(cfdNet(position, 95)).toBe(-10500); // liquidation loses investment plus paid fee
    expect(cfdNet(position, null)).toBeNull(); // no invented mark on an unselected market
  });
  it("retains legacy 1× leverage and adapts only chart geometry to UP/DOWN", () => {
    expect(cfdNet({ ...position, leverage: 1 }, 101)).toBe(-400);
    expect(cfdChartTrade({ ...position, direction: "SHORT" })).toMatchObject({ direction: "DOWN", entryPrice: 100, payoutPct: 0 });
  });
  it("allows absent stops but refuses malformed, zero and out-of-range percentages", () => {
    expect(protectionPct("", 99.99)).toBeUndefined();
    expect(protectionPct("0.5", 99.99)).toBe(0.5);
    for (const bad of ["0", "-1", "100", "NaN", "1e1"]) expect(protectionPct(bad, 99.99)).toBeNull();
  });
});
it("never drops older open positions when the closed-history memory cap is reached", () => {
  const old = { ...position, id: "old-open", entryTs: 1 };
  const recent = Array.from({ length: 150 }, (_, i) => ({ ...position, id: `closed-${i}`, entryTs: 100+i, status: "CLOSED" as const }));
  const rows = mergeCfd({}, "a1", [old, ...recent]).a1!;
  expect(rows.some(t => t.id === old.id)).toBe(true);
  expect(rows.filter(t => t.status === "CLOSED")).toHaveLength(100);
});
it("does not overwrite converted closed units with a delayed legacy socket settlement", () => {
  const converted = { ...position, status: "CLOSED" as const, stake: 91, pnl: 10, spreadFee: 5 };
  const book = mergeCfd({}, "a1", [converted]);
  expect(mergeCfd(book, "a1", [{ ...position, status: "CLOSED" }], "socket").a1?.[0]).toEqual(converted);
});
