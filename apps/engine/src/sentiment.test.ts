import { describe, expect, it } from "vitest";
import type { Position } from "@asm/trading";
import { computeSentiment } from "./sentiment";

function pos(direction: "UP" | "DOWN", stake: number): Position {
  return {
    tradeId: "t",
    accountId: "a",
    assetId: "x",
    direction,
    stake,
    payoutPct: 100,
    entryPrice: 1,
    expirySec: 0,
  };
}

describe("computeSentiment", () => {
  it("returns an even split for an empty book", () => {
    expect(computeSentiment([])).toEqual({ upPct: 50, downPct: 50 });
  });

  it("weights by stake, not head count", () => {
    // One big DOWN outweighs two small UPs.
    const positions = [pos("UP", 100), pos("UP", 100), pos("DOWN", 800)];
    expect(computeSentiment(positions)).toEqual({ upPct: 20, downPct: 80 });
  });

  it("always sums to 100", () => {
    const { upPct, downPct } = computeSentiment([pos("UP", 1), pos("DOWN", 2)]);
    expect(upPct + downPct).toBe(100);
  });

  it("is fully up when every position is UP", () => {
    expect(computeSentiment([pos("UP", 50), pos("UP", 50)])).toEqual({ upPct: 100, downPct: 0 });
  });
});
