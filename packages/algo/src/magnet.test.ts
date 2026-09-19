import { describe, expect, it } from "vitest";
import { expiryMagnet, reachableMove, targetMargin } from "./magnet";
import { MAGNET_CAP, MAGNET_WINDOW_SEC } from "./constants";

const sigmaTick = 0.0003;

describe("expiryMagnet", () => {
  it("returns zero outside the window", () => {
    expect(
      expiryMagnet({
        currentPrice: 1.175,
        targetPrice: 1.18,
        secondsLeft: MAGNET_WINDOW_SEC + 1,
        sigmaTick,
      }),
    ).toBe(0);
  });

  it("returns zero for equal prices", () => {
    expect(
      expiryMagnet({
        currentPrice: 1.175,
        targetPrice: 1.175,
        secondsLeft: 5,
        sigmaTick,
      }),
    ).toBe(0);
  });

  it("returns a pull toward a higher target", () => {
    const pull = expiryMagnet({
      currentPrice: 1.175,
      targetPrice: 1.18,
      secondsLeft: 2,
      sigmaTick,
    });
    expect(pull).toBeGreaterThan(0);
  });

  it("returns a pull toward a lower target", () => {
    const pull = expiryMagnet({
      currentPrice: 1.175,
      targetPrice: 1.17,
      secondsLeft: 2,
      sigmaTick,
    });
    expect(pull).toBeLessThan(0);
  });

  it("grows with urgency as secondsLeft approaches zero", () => {
    const far = Math.abs(expiryMagnet({ currentPrice: 1.175, targetPrice: 1.18, secondsLeft: MAGNET_WINDOW_SEC - 1, sigmaTick }));
    const near = Math.abs(expiryMagnet({ currentPrice: 1.175, targetPrice: 1.18, secondsLeft: 1, sigmaTick }));
    expect(near).toBeGreaterThan(far);
  });

  it("never exceeds MAGNET_CAP × sigmaTick", () => {
    const pull = expiryMagnet({
      currentPrice: 1.0,
      targetPrice: 100.0,
      secondsLeft: 0,
      sigmaTick,
    });
    expect(Math.abs(pull)).toBeLessThanOrEqual(MAGNET_CAP * sigmaTick + 1e-15);
  });
});

describe("reachableMove", () => {
  it("is positive for any positive input", () => {
    expect(reachableMove({ price: 1.175, sigmaTick, secondsLeft: 30, dtSec: 0.1 })).toBeGreaterThan(0);
  });

  it("grows with more seconds remaining", () => {
    const short = reachableMove({ price: 1.175, sigmaTick, secondsLeft: 5, dtSec: 0.1 });
    const long = reachableMove({ price: 1.175, sigmaTick, secondsLeft: 30, dtSec: 0.1 });
    expect(long).toBeGreaterThan(short);
  });
});

describe("targetMargin", () => {
  it("is at least one tick size", () => {
    const margin = targetMargin({ price: 1.175, sigmaTick: 1e-10, tickSize: 0.00001 });
    expect(margin).toBeGreaterThanOrEqual(0.00001);
  });

  it("is a positive multiple of tickSize", () => {
    const tickSize = 0.00001;
    const margin = targetMargin({ price: 1.175, sigmaTick, tickSize });
    expect(margin % tickSize).toBeCloseTo(0, 8);
    expect(margin).toBeGreaterThan(0);
  });
});
