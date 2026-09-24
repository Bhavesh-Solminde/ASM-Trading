import { describe, expect, it } from "vitest";
import type { Position } from "@asm/trading";
import {
  driftBias,
  exposureScale,
  imbalance,
  totalExposure,
} from "../src/index";

/**
 * Every-rupee-counts coverage. The pre-2026-09-24 build refused to apply any
 * chart bias for books below EXPOSURE_FLOOR (₹500). Under the house-first
 * design, EXPOSURE_FLOOR is 1 paise — every rupee of open interest tilts
 * the chart, even a lone ₹1 trade. These tests replace the old thin-book
 * guard tests and lock in the new behavior.
 */

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
    isDemo: false,
  };
}

describe("every rupee counts", () => {
  it("even a ₹1 stake produces non-zero chart bias", () => {
    const book = [position(100)]; // ₹1 in paise
    const bias = driftBias({
      imbalance: imbalance(book, 1_000_000),
      exposure: totalExposure(book),
      sigma: 0.001,
    });
    // Small but non-zero — proves the floor is truly gone.
    expect(Math.abs(bias)).toBeGreaterThan(0);
  });

  it("still applies zero bias for an empty book", () => {
    expect(
      driftBias({ imbalance: imbalance([], 1_000_000), exposure: 0, sigma: 0.001 }),
    ).toBe(0);
  });

  it("reports full imbalance for one lone position, regardless of stake", () => {
    // A single UP trade → all pressure is UP → imbalance saturates at +1.
    // exposureScale scales the bias magnitude but not the imbalance itself.
    expect(imbalance([position(100)], 1_000_000)).toBeCloseTo(1, 6);
    // exposureScale on ₹1 is a tiny positive number, no longer zero.
    expect(exposureScale(100)).toBeGreaterThan(0);
    expect(exposureScale(100)).toBeLessThan(0.01);
  });

  it("bias magnitude scales monotonically with total book size", () => {
    // Same directional pressure, growing exposure → growing |bias|. The
    // small-book bias is not zero, and the big-book bias is bigger.
    const small = [position(100)];
    const big = [position(1_000_000)];
    const smallBias = Math.abs(
      driftBias({
        imbalance: imbalance(small, 1_000_000),
        exposure: totalExposure(small),
        sigma: 0.001,
      }),
    );
    const bigBias = Math.abs(
      driftBias({
        imbalance: imbalance(big, 1_000_000),
        exposure: totalExposure(big),
        sigma: 0.001,
      }),
    );
    expect(smallBias).toBeGreaterThan(0);
    expect(bigBias).toBeGreaterThan(smallBias);
  });
});
