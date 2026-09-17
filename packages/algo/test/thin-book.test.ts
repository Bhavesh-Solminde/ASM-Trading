import { describe, expect, it } from "vitest";
import type { Position } from "@asm/trading";
import {
  EXPOSURE_FLOOR,
  driftBias,
  exposureScale,
  imbalance,
  totalExposure,
} from "../src/index";

let seq = 0;
function position(stake: number, direction: "UP" | "DOWN" = "UP"): Position {
  return {
    tradeId: `t-${++seq}`,
    accountId: "a",
    assetId: "asset-1",
    direction,
    stake,
    payoutPct: 100,
    entryPrice: 1.175,
    expirySec: 1_000_060,
  };
}

describe("thin book guard", () => {
  it("applies zero bias for a single small trade", () => {
    const book = [position(100)];
    const bias = driftBias({
      imbalance: imbalance(book, 1_000_000),
      exposure: totalExposure(book),
      sigma: 0.001,
    });
    expect(bias).toBe(0);
  });

  it("applies zero bias for an empty book", () => {
    expect(
      driftBias({ imbalance: imbalance([], 1_000_000), exposure: 0, sigma: 0.001 }),
    ).toBe(0);
  });

  it("still reports full imbalance for one trade", () => {
    expect(imbalance([position(100)], 1_000_000)).toBeCloseTo(1, 6);
    expect(exposureScale(100)).toBe(0);
  });

  it("begins biasing only once the book crosses the floor", () => {
    const below = [position(EXPOSURE_FLOOR - 1_000)];
    const above = [position(EXPOSURE_FLOOR * 4)];

    expect(
      driftBias({
        imbalance: imbalance(below, 1_000_000),
        exposure: totalExposure(below),
        sigma: 0.001,
      }),
    ).toBe(0);

    expect(
      Math.abs(
        driftBias({
          imbalance: imbalance(above, 1_000_000),
          exposure: totalExposure(above),
          sigma: 0.001,
        }),
      ),
    ).toBeGreaterThan(0);
  });
});
