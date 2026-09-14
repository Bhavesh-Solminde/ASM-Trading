import { describe, expect, it } from "vitest";
import { didWin, settlementCredit, settlementPnl } from "./outcome";
import { DURATIONS_SEC, isValidDuration } from "./durations";

describe("didWin", () => {
  it("wins an UP trade when the price rose", () => {
    expect(didWin("UP", 1.175, 1.176)).toBe("WON");
  });

  it("loses an UP trade when the price fell", () => {
    expect(didWin("UP", 1.175, 1.174)).toBe("LOST");
  });

  it("wins a DOWN trade when the price fell", () => {
    expect(didWin("DOWN", 1.175, 1.174)).toBe("WON");
  });

  it("loses a DOWN trade when the price rose", () => {
    expect(didWin("DOWN", 1.175, 1.176)).toBe("LOST");
  });

  it("refunds an exact tie in either direction", () => {
    expect(didWin("UP", 1.175, 1.175)).toBe("REFUNDED");
    expect(didWin("DOWN", 1.175, 1.175)).toBe("REFUNDED");
  });
});

describe("settlementCredit", () => {
  it("returns stake plus profit at 100% payout", () => {
    expect(settlementCredit(10_000, 100, "WON")).toBe(20_000);
  });

  it("returns stake plus profit at 92% payout", () => {
    expect(settlementCredit(10_000, 92, "WON")).toBe(19_200);
  });

  it("returns nothing on a loss", () => {
    expect(settlementCredit(10_000, 92, "LOST")).toBe(0);
  });

  it("returns the stake on a refund", () => {
    expect(settlementCredit(10_000, 92, "REFUNDED")).toBe(10_000);
  });

  it("returns whole minor units at awkward payouts", () => {
    const credit = settlementCredit(333, 67, "WON");
    expect(Number.isInteger(credit)).toBe(true);
  });

  it("rounds profit toward the house", () => {
    // 333 * 0.67 = 223.11 -> profit floors to 223, total 556
    expect(settlementCredit(333, 67, "WON")).toBe(556);
  });
});

describe("settlementPnl", () => {
  it("is positive profit on a win", () => {
    expect(settlementPnl(10_000, 92, "WON")).toBe(9_200);
  });

  it("is the negative stake on a loss", () => {
    expect(settlementPnl(10_000, 92, "LOST")).toBe(-10_000);
  });

  it("is zero on a refund", () => {
    expect(settlementPnl(10_000, 92, "REFUNDED")).toBe(0);
  });
});

describe("durations", () => {
  it("offers the thirteen platform durations", () => {
    expect(DURATIONS_SEC.length).toBe(13);
    expect(DURATIONS_SEC[0]).toBe(5);
    expect(DURATIONS_SEC[DURATIONS_SEC.length - 1]).toBe(14_400);
  });

  it("accepts a listed duration and rejects anything else", () => {
    expect(isValidDuration(60)).toBe(true);
    expect(isValidDuration(37)).toBe(false);
  });
});
