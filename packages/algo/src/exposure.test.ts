import { describe, expect, it } from "vitest";
import type { Position } from "@asm/trading";
import { driftBias, exposureScale, imbalance, totalExposure } from "./exposure";
import { BIAS_SIGMA_CAP, EXPOSURE_FLOOR, EXPOSURE_FULL } from "./constants";

let seq = 0;
function p(overrides: Partial<Position> = {}): Position {
  return {
    tradeId: `t-${++seq}`,
    accountId: "a",
    assetId: "asset-1",
    direction: "UP",
    stake: 100_000,
    payoutPct: 100,
    entryPrice: 1.175,
    expirySec: 1_000_060,
    ...overrides,
  };
}

const NOW = 1_000_000;

describe("totalExposure", () => {
  it("sums stake times payout", () => {
    expect(totalExposure([p({ stake: 100, payoutPct: 100 })])).toBe(100);
    expect(totalExposure([p({ stake: 100, payoutPct: 50 })])).toBe(50);
  });

  it("is zero for an empty book", () => {
    expect(totalExposure([])).toBe(0);
  });
});

describe("imbalance", () => {
  it("is zero for an empty book", () => {
    expect(imbalance([], NOW)).toBe(0);
  });

  it("is positive when the book is long — the house wants the price down", () => {
    expect(imbalance([p({ direction: "UP" })], NOW)).toBeGreaterThan(0);
  });

  it("is negative when the book is short", () => {
    expect(imbalance([p({ direction: "DOWN" })], NOW)).toBeLessThan(0);
  });

  it("is near zero when the book is balanced by stake", () => {
    const book = [
      p({ direction: "UP", stake: 100_000 }),
      p({ direction: "DOWN", stake: 100_000 }),
    ];
    expect(Math.abs(imbalance(book, NOW))).toBeLessThan(1e-9);
  });

  it("weights by stake, not head count", () => {
    const book = [
      ...Array.from({ length: 60 }, () => p({ direction: "UP", stake: 1_000 })),
      ...Array.from({ length: 40 }, () => p({ direction: "DOWN", stake: 10_000 })),
    ];
    expect(imbalance(book, NOW)).toBeLessThan(0);
  });

  it("weights near expiries more heavily than distant ones", () => {
    const near = [
      p({ direction: "UP", expirySec: NOW + 1 }),
      p({ direction: "DOWN", expirySec: NOW + 600 }),
    ];
    expect(imbalance(near, NOW)).toBeGreaterThan(0);
  });

  it("stays within [-1, 1] for any book", () => {
    const book = Array.from({ length: 500 }, (_, i) =>
      p({ direction: i % 3 === 0 ? "DOWN" : "UP", stake: 10_000 * (i + 1) }),
    );
    const value = imbalance(book, NOW);
    expect(value).toBeGreaterThanOrEqual(-1);
    expect(value).toBeLessThanOrEqual(1);
  });
});

describe("exposureScale", () => {
  it("is zero below the floor", () => {
    expect(exposureScale(0)).toBe(0);
    expect(exposureScale(EXPOSURE_FLOOR - 1)).toBe(0);
  });

  it("is one at and above full exposure", () => {
    expect(exposureScale(EXPOSURE_FULL)).toBe(1);
    expect(exposureScale(EXPOSURE_FULL * 10)).toBe(1);
  });

  it("ramps linearly between floor and full", () => {
    const mid = (EXPOSURE_FLOOR + EXPOSURE_FULL) / 2;
    expect(exposureScale(mid)).toBeCloseTo(0.5, 6);
  });
});

describe("driftBias", () => {
  it("is zero when exposure is below the floor", () => {
    expect(driftBias({ imbalance: 1, exposure: 0, sigma: 0.001 })).toBe(0);
  });

  it("is negative for a positive imbalance", () => {
    const bias = driftBias({ imbalance: 0.5, exposure: EXPOSURE_FULL, sigma: 0.001 });
    expect(bias).toBeLessThan(0);
  });

  it("is positive for a negative imbalance", () => {
    const bias = driftBias({ imbalance: -0.5, exposure: EXPOSURE_FULL, sigma: 0.001 });
    expect(bias).toBeGreaterThan(0);
  });

  it("never exceeds BIAS_SIGMA_CAP multiples of sigma", () => {
    const sigma = 0.002;
    for (const imb of [-1, -0.7, 0, 0.7, 1]) {
      const bias = driftBias({ imbalance: imb, exposure: EXPOSURE_FULL * 100, sigma });
      expect(Math.abs(bias)).toBeLessThanOrEqual(BIAS_SIGMA_CAP * sigma + 1e-15);
    }
  });

  it("scales with exposure", () => {
    const low = Math.abs(
      driftBias({ imbalance: 1, exposure: EXPOSURE_FLOOR + 1_000, sigma: 0.001 }),
    );
    const high = Math.abs(
      driftBias({ imbalance: 1, exposure: EXPOSURE_FULL, sigma: 0.001 }),
    );
    expect(high).toBeGreaterThan(low);
  });
});
