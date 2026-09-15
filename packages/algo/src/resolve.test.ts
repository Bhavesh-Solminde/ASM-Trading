import { describe, expect, it } from "vitest";
import { resolveBucket, type BucketWish } from "./resolve";

function wish(overrides: Partial<BucketWish> = {}): BucketWish {
  return {
    entryPrice: 1.175,
    direction: "UP",
    wantWin: false,
    urgency: 1,
    stake: 10_000,
    payoutPct: 100,
    ...overrides,
  };
}

const TICK = 0.00001;

describe("resolveBucket", () => {
  it("returns the current price for an empty bucket", () => {
    const target = resolveBucket({
      wishes: [],
      currentPrice: 1.175,
      maxMove: 0.01,
      tickSize: TICK,
    });
    expect(target).toBe(1.175);
  });

  it("moves below the entry price to lose a single UP wish", () => {
    const target = resolveBucket({
      wishes: [wish({ direction: "UP", wantWin: false, entryPrice: 1.175 })],
      currentPrice: 1.175,
      maxMove: 0.01,
      tickSize: TICK,
    });
    expect(target).toBeLessThan(1.175);
  });

  it("moves above the entry price to win a single UP wish", () => {
    const target = resolveBucket({
      wishes: [wish({ direction: "UP", wantWin: true, entryPrice: 1.175 })],
      currentPrice: 1.175,
      maxMove: 0.01,
      tickSize: TICK,
    });
    expect(target).toBeGreaterThan(1.175);
  });

  it("satisfies both when entries straddle compatibly", () => {
    const target = resolveBucket({
      wishes: [
        wish({ direction: "UP", entryPrice: 1.175, wantWin: true }),
        wish({ direction: "DOWN", entryPrice: 1.176, wantWin: true }),
      ],
      currentPrice: 1.1755,
      maxMove: 0.01,
      tickSize: TICK,
    });
    expect(target).toBeGreaterThan(1.175);
    expect(target).toBeLessThan(1.176);
  });

  it("favours the higher-urgency wish when they are incompatible", () => {
    const target = resolveBucket({
      wishes: [
        wish({ direction: "UP", entryPrice: 1.176, wantWin: true, urgency: 2 }),
        wish({ direction: "DOWN", entryPrice: 1.175, wantWin: true, urgency: 0.1 }),
      ],
      currentPrice: 1.1755,
      maxMove: 0.01,
      tickSize: TICK,
    });
    expect(target).toBeGreaterThan(1.176);
  });

  it("never returns a price outside maxMove of current", () => {
    const target = resolveBucket({
      wishes: [wish({ direction: "UP", entryPrice: 2.0, wantWin: true })],
      currentPrice: 1.175,
      maxMove: 0.0005,
      tickSize: TICK,
    });
    expect(Math.abs(target - 1.175)).toBeLessThanOrEqual(0.0005 + 1e-12);
  });

  it("is deterministic for identical input", () => {
    const input = {
      wishes: [
        wish({ direction: "UP", entryPrice: 1.175, wantWin: false, urgency: 1 }),
        wish({ direction: "DOWN", entryPrice: 1.1752, wantWin: true, urgency: 1 }),
      ],
      currentPrice: 1.1751,
      maxMove: 0.01,
      tickSize: TICK,
    };
    expect(resolveBucket(input)).toBe(resolveBucket(input));
  });

  it("satisfies the majority of wishes for a large mixed bucket", () => {
    const wishes: BucketWish[] = Array.from({ length: 40 }, (_, i) =>
      wish({
        direction: i % 2 === 0 ? "UP" : "DOWN",
        entryPrice: 1.175 + (i - 20) * TICK,
        wantWin: false,
        urgency: 1,
      }),
    );
    const target = resolveBucket({
      wishes,
      currentPrice: 1.175,
      maxMove: 0.01,
      tickSize: TICK,
    });
    const satisfied = wishes.filter((w) => {
      const rose = target > w.entryPrice;
      const won = w.direction === "UP" ? rose : !rose;
      return won === w.wantWin;
    }).length;
    // This construction interleaves each UP wish's entry `e` with a DOWN
    // wish's entry at exactly `e + tickSize`, both wanting to lose — for any
    // price x, x falling in (e, e+tick] satisfies the DOWN wish but not the
    // UP one, and any other x satisfies both or neither. That caps the
    // achievable count at exactly half (20/40) for every possible resolver,
    // not just this one — so the meaningful assertion is that resolveBucket
    // reaches that provable optimum, not that it beats an unreachable bar.
    expect(satisfied).toBeGreaterThanOrEqual(wishes.length / 2);
  });
});
