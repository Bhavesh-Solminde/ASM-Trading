import { describe, it, expect } from "vitest";
import {
  computeSpread,
  fillPrice,
  userSpreadMultiplier,
  userFillSkew,
  earlyCloseMultiplier,
  isHardBlocked,
} from "../spread";

describe("computeSpread", () => {
  it("computes bid/ask from mid price and basis points", () => {
    const { bid, ask } = computeSpread(95000, 5, 1);
    expect(ask).toBeCloseTo(95023.75, 1);
    expect(bid).toBeCloseTo(94976.25, 1);
  });

  it("applies user multiplier", () => {
    const normal = computeSpread(95000, 5, 1);
    const punished = computeSpread(95000, 5, 3);

    const normalSpread = normal.ask - normal.bid;
    const punishedSpread = punished.ask - punished.bid;
    expect(punishedSpread).toBeCloseTo(normalSpread * 3, 1);
  });

  it("spread is symmetric around mid price", () => {
    const { bid, ask } = computeSpread(100, 10, 1);
    const mid = (bid + ask) / 2;
    expect(mid).toBeCloseTo(100, 5);
  });
});

describe("fillPrice", () => {
  it("fills LONG at ask with no skew", () => {
    expect(fillPrice("UP", 94976, 95024, 0)).toBe(95024);
  });

  it("fills SHORT at bid with no skew", () => {
    expect(fillPrice("DOWN", 94976, 95024, 0)).toBe(94976);
  });

  it("skews LONG fill further against the user", () => {
    const price = fillPrice("UP", 94976, 95024, 0.5);
    expect(price).toBeGreaterThan(95024);
  });

  it("skews SHORT fill further against the user", () => {
    const price = fillPrice("DOWN", 94976, 95024, 0.5);
    expect(price).toBeLessThan(94976);
  });
});

describe("userSpreadMultiplier", () => {
  it("returns 1 when user is below daily win cap", () => {
    expect(userSpreadMultiplier(5000, 10000)).toBe(1);
  });

  it("returns 3 when user hits daily win cap", () => {
    expect(userSpreadMultiplier(10000, 10000)).toBe(3);
  });

  it("returns 3 between 1x and 2x cap", () => {
    expect(userSpreadMultiplier(15000, 10000)).toBe(3);
  });

  it("returns 1 when below cap", () => {
    expect(userSpreadMultiplier(9999, 10000)).toBe(1);
  });
});

describe("userFillSkew", () => {
  it("returns 0 below cap", () => {
    expect(userFillSkew(5000, 10000)).toBe(0);
  });

  it("returns 0.5 at cap", () => {
    expect(userFillSkew(10000, 10000)).toBe(0.5);
  });
});

describe("earlyCloseMultiplier", () => {
  it("blocks close within 10 seconds", () => {
    expect(earlyCloseMultiplier(5)).toBe(Infinity);
    expect(earlyCloseMultiplier(0)).toBe(Infinity);
    expect(earlyCloseMultiplier(9)).toBe(Infinity);
  });

  it("returns 2x within 60 seconds", () => {
    expect(earlyCloseMultiplier(10)).toBe(2);
    expect(earlyCloseMultiplier(30)).toBe(2);
    expect(earlyCloseMultiplier(59)).toBe(2);
  });

  it("returns 1x after 60 seconds", () => {
    expect(earlyCloseMultiplier(60)).toBe(1);
    expect(earlyCloseMultiplier(120)).toBe(1);
  });
});

describe("isHardBlocked", () => {
  it("returns false below 2x cap", () => {
    expect(isHardBlocked(19999, 10000)).toBe(false);
  });

  it("returns true at 2x cap", () => {
    expect(isHardBlocked(20000, 10000)).toBe(true);
  });

  it("returns true above 2x cap", () => {
    expect(isHardBlocked(25000, 10000)).toBe(true);
  });
});
