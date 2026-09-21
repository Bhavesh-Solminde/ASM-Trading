import { describe, expect, it } from "vitest";
import { closedRowDisplay, grossReturnMinor } from "./pnl-display";

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
