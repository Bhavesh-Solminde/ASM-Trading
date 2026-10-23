import { describe, expect, it } from "vitest";
import { cfdOpenPnl, closedRowDisplay, grossReturnMinor } from "./pnl-display";

describe("grossReturnMinor", () => {
  it("adds profit to the stake", () => {
    expect(grossReturnMinor(10_000, 10_000)).toBe(20_000);
    expect(grossReturnMinor(10_000, 8_500)).toBe(18_500);
  });
});

describe("closedRowDisplay", () => {
  it("shows the gross return on a win (stake + profit)", () => {
    // $100 stake, +$100 net profit → +$200 gross.
    expect(closedRowDisplay({ status: "WON", stake: 10_000, pnl: 10_000 })).toEqual({
      sign: "+",
      amountMinor: 20_000,
      className: "text-up",
    });
  });

  it("shows the stake lost on a loss", () => {
    expect(closedRowDisplay({ status: "LOST", stake: 10_000, pnl: -10_000 })).toEqual({
      sign: "−",
      amountMinor: 10_000,
      className: "text-ink-3",
    });
  });

  it("shows a signless zero on a refund", () => {
    expect(closedRowDisplay({ status: "REFUNDED", stake: 10_000, pnl: 0 })).toEqual({
      sign: "",
      amountMinor: 0,
      className: "text-ink-2",
    });
  });
});
it("shows actual signed CFD profit after confirmed closure", () => {
  expect(closedRowDisplay({ status: "CLOSED", stake: 10000, pnl: 100 })).toEqual({ sign: "+", amountMinor: 100, className: "text-up" });
});

it("estimates CFD net movement rather than losing the whole investment", () => {
  const trade = { direction: "UP" as const, stake: 10000, entryPrice: 100 };
  expect(cfdOpenPnl(trade, 99)).toBe(-100);
  expect(cfdOpenPnl(trade, 101)).toBe(100);
  expect(cfdOpenPnl({ ...trade, direction: "DOWN" }, 101)).toBe(-100);
  expect(cfdOpenPnl({ ...trade, direction: "DOWN" }, 400)).toBe(-10000);
  expect(cfdOpenPnl(trade, null)).toBeNull();
});
