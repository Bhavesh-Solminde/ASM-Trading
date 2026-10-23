import { describe, it, expect } from "vitest";
import { computeMagnetPull, adaptiveAggression } from "../cfd-magnet";

describe("adaptiveAggression", () => {
  it("returns 3.5× for <20 users", () => {
    expect(adaptiveAggression(0)).toBe(3.5);
    expect(adaptiveAggression(5)).toBe(3.5);
    expect(adaptiveAggression(19)).toBe(3.5);
  });

  it("returns 3.0× for 20-49 users", () => {
    expect(adaptiveAggression(20)).toBe(3.0);
    expect(adaptiveAggression(35)).toBe(3.0);
    expect(adaptiveAggression(49)).toBe(3.0);
  });

  it("returns 2.7× for 50-99 users", () => {
    expect(adaptiveAggression(50)).toBe(2.7);
    expect(adaptiveAggression(75)).toBe(2.7);
    expect(adaptiveAggression(99)).toBe(2.7);
  });

  it("returns 2.5× for ≥100 users — permanent floor", () => {
    expect(adaptiveAggression(100)).toBe(2.5);
    expect(adaptiveAggression(1000)).toBe(2.5);
    expect(adaptiveAggression(10000)).toBe(2.5);
  });
});

describe("computeMagnetPull", () => {
  const sigma = 0.005;

  it("returns 0 when no positions", () => {
    expect(
      computeMagnetPull({
        positions: [],
        realMoveSign: 1,
        volatility: 0.01,
        sigma,
        activeUsers: 50,
      }),
    ).toBe(0);
  });

  it("returns 0 when sigma is 0", () => {
    expect(
      computeMagnetPull({
        positions: [{ direction: "UP", stake: 10000, stopLoss: null, pnlFrac: 0 }],
        realMoveSign: -1,
        volatility: 0.01,
        sigma: 0,
        activeUsers: 50,
      }),
    ).toBe(0);
  });

  it("anti-crowd: pushes against net LONG exposure", () => {
    const pull = computeMagnetPull({
      positions: [
        { direction: "UP", stake: 10000, stopLoss: null, pnlFrac: 0 },
        { direction: "UP", stake: 10000, stopLoss: null, pnlFrac: 0 },
        { direction: "DOWN", stake: 5000, stopLoss: null, pnlFrac: 0 },
      ],
      realMoveSign: -1,
      volatility: 0.01,
      sigma,
      activeUsers: 50,
    });
    expect(pull).toBeLessThan(0);
  });

  it("anti-crowd: pushes against net SHORT exposure", () => {
    const pull = computeMagnetPull({
      positions: [
        { direction: "DOWN", stake: 10000, stopLoss: null, pnlFrac: 0 },
        { direction: "DOWN", stake: 10000, stopLoss: null, pnlFrac: 0 },
        { direction: "UP", stake: 5000, stopLoss: null, pnlFrac: 0 },
      ],
      realMoveSign: 1,
      volatility: 0.01,
      sigma,
      activeUsers: 50,
    });
    expect(pull).toBeGreaterThan(0);
  });

  it("stronger pull at higher aggression (fewer users)", () => {
    const mkInput = (users: number) => ({
      positions: [
        { direction: "UP" as const, stake: 10000, stopLoss: null, pnlFrac: 0 },
      ],
      realMoveSign: -1,
      volatility: 0.01,
      sigma,
      activeUsers: users,
    });

    const pullFew = Math.abs(computeMagnetPull(mkInput(10)));
    const pullMany = Math.abs(computeMagnetPull(mkInput(200)));
    expect(pullFew).toBeGreaterThan(pullMany);
  });

  it("vol-aware gating: low volatility reduces pull", () => {
    const base = {
      positions: [{ direction: "UP" as const, stake: 10000, stopLoss: null, pnlFrac: 0 }],
      realMoveSign: -1,
      sigma,
      activeUsers: 50,
    };

    const lowVol = Math.abs(computeMagnetPull({ ...base, volatility: 0.001 }));
    const highVol = Math.abs(computeMagnetPull({ ...base, volatility: 0.01 }));
    expect(highVol).toBeGreaterThan(lowVol);
  });

  it("SL gravity pushes down when LONG SL cluster and real moving down", () => {
    const pull = computeMagnetPull({
      positions: [
        { direction: "UP", stake: 10000, stopLoss: 94000, pnlFrac: 0 },
        { direction: "UP", stake: 10000, stopLoss: 94100, pnlFrac: 0 },
        { direction: "UP", stake: 10000, stopLoss: 94050, pnlFrac: 0 },
      ],
      realMoveSign: -1,
      volatility: 0.01,
      sigma,
      activeUsers: 50,
    });
    expect(pull).toBeLessThan(0);
  });

  it("no SL gravity when too few SL positions", () => {
    const withSl = computeMagnetPull({
      positions: [
        { direction: "UP", stake: 10000, stopLoss: 94000, pnlFrac: 0 },
        { direction: "UP", stake: 10000, stopLoss: null, pnlFrac: 0 },
      ],
      realMoveSign: -1,
      volatility: 0.01,
      sigma,
      activeUsers: 50,
    });

    const withoutSl = computeMagnetPull({
      positions: [
        { direction: "UP", stake: 10000, stopLoss: null, pnlFrac: 0 },
        { direction: "UP", stake: 10000, stopLoss: null, pnlFrac: 0 },
      ],
      realMoveSign: -1,
      volatility: 0.01,
      sigma,
      activeUsers: 50,
    });

    // Only 1 SL in withSl, needs ≥3 for SL gravity — so both should be equal
    // (anti-crowd is the same, SL gravity is 0 in both)
    expect(withSl).toBeCloseTo(withoutSl, 10);
  });

  it("profit drag slows big winners", () => {
    const noDrag = computeMagnetPull({
      positions: [
        { direction: "UP", stake: 10000, stopLoss: null, pnlFrac: 0.001 },
      ],
      realMoveSign: -1,
      volatility: 0.01,
      sigma,
      activeUsers: 50,
    });

    const withDrag = computeMagnetPull({
      positions: [
        { direction: "UP", stake: 10000, stopLoss: null, pnlFrac: 0.01 },
      ],
      realMoveSign: -1,
      volatility: 0.01,
      sigma,
      activeUsers: 50,
    });

    // With 1% profit, drag should add more downward pull
    expect(withDrag).toBeLessThan(noDrag);
  });
});
