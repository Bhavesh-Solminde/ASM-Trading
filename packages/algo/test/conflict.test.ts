import { describe, expect, it } from "vitest";
import { resolveBucket, type BucketWish } from "../src/index";

const TICK = 0.00001;

function wish(o: Partial<BucketWish>): BucketWish {
  return {
    entryPrice: 1.175, direction: "UP", wantWin: true,
    urgency: 1, stake: 10_000, payoutPct: 100, ...o,
  };
}

describe("bucket conflict resolution", () => {
  const incompatible = [
    wish({ direction: "UP", entryPrice: 1.176, wantWin: true, urgency: 1.5 }),
    wish({ direction: "DOWN", entryPrice: 1.175, wantWin: true, urgency: 0.5 }),
  ];

  it("resolves rather than deadlocking", () => {
    const target = resolveBucket({
      wishes: incompatible, currentPrice: 1.1755, maxMove: 0.01, tickSize: TICK,
    });
    expect(Number.isFinite(target)).toBe(true);
  });

  it("gives the win to the higher-urgency position", () => {
    const target = resolveBucket({
      wishes: incompatible, currentPrice: 1.1755, maxMove: 0.01, tickSize: TICK,
    });
    expect(target).toBeGreaterThan(1.176);
  });

  it("is deterministic across repeated calls", () => {
    const input = {
      wishes: incompatible, currentPrice: 1.1755, maxMove: 0.01, tickSize: TICK,
    };
    const results = Array.from({ length: 20 }, () => resolveBucket(input));
    expect(new Set(results).size).toBe(1);
  });

  it("does not crash on fifty mutually conflicting wishes", () => {
    const wishes = Array.from({ length: 50 }, (_, i) =>
      wish({
        direction: i % 2 === 0 ? "UP" : "DOWN",
        entryPrice: 1.175 + (i % 5) * TICK,
        wantWin: true,
        urgency: (i % 3) + 0.5,
      }),
    );
    const target = resolveBucket({
      wishes, currentPrice: 1.175, maxMove: 0.001, tickSize: TICK,
    });
    expect(Number.isFinite(target)).toBe(true);
    expect(Math.abs(target - 1.175)).toBeLessThanOrEqual(0.001 + 1e-12);
  });

  it("falls back to the current price when nothing is reachable", () => {
    const target = resolveBucket({
      wishes: [wish({ entryPrice: 5, wantWin: true })],
      currentPrice: 1.175, maxMove: 0, tickSize: TICK,
    });
    expect(target).toBe(1.175);
  });
});
