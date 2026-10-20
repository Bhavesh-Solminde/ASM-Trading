import { describe, expect, it } from "vitest";
import { backoffDelay, unitFromBytes } from "./backoff";

describe("backoffDelay", () => {
  it("grows 0.5s, 1s, 2s, 4s, 8s then caps at 15s (no jitter at random=0.5)", () => {
    const mid = () => 0.5;
    expect([0, 1, 2, 3, 4, 5, 9].map((a) => backoffDelay(a, mid))).toEqual([500, 1000, 2000, 4000, 8000, 15000, 15000]);
  });
  it("applies ±20% jitter", () => {
    expect(backoffDelay(0, () => 0)).toBe(400);
    expect(backoffDelay(0, () => 1)).toBe(600);
  });
  it("jitters the 15s cap too", () => {
    expect(backoffDelay(7, () => 0)).toBe(12_000);
    expect(backoffDelay(7, () => 1)).toBe(18_000);
  });
});

describe("unitFromBytes", () => {
  it("maps the byte range onto [0, 1)", () => {
    expect(unitFromBytes(new Uint8Array([0, 0, 0, 0]))).toBe(0);
    expect(unitFromBytes(new Uint8Array([128, 0, 0, 0]))).toBe(0.5);
    const max = unitFromBytes(new Uint8Array([255, 255, 255, 255]));
    expect(max).toBeLessThan(1);
    expect(max).toBeGreaterThan(0.999999);
  });
});
