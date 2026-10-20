import { describe, expect, it } from "vitest";
import { sparkline } from "./sparkline-path";

describe("sparkline", () => {
  it("is deterministic for a seed (no Math.random)", () => {
    expect(sparkline(7, 386, 128, 70)).toEqual(sparkline(7, 386, 128, 70));
    expect(sparkline(7, 386, 128, 70).line).not.toEqual(sparkline(8, 386, 128, 70).line);
  });
  it("spans the width and stays inside the box", () => {
    const s = sparkline(7, 386, 128, 70);
    expect(s.line.startsWith("M0.0 ")).toBe(true);
    expect(s.lastX).toBeCloseTo(386);
    const ys = [...s.line.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(8);
    expect(Math.max(...ys)).toBeLessThanOrEqual(128 - 32);
    expect(s.fill.endsWith(`L0 128 Z`)).toBe(true);
  });
  it("needs two points", () => {
    expect(sparkline(7, 100, 50, 1).line).toBe("");
  });
});
