import { describe, expect, it } from "vitest";
import { lockLayout } from "./lock-layout";

describe("lockLayout", () => {
  it("uses the roomy layout on a normal phone", () => {
    expect(lockLayout(800)).toEqual({ logoWidth: 72, gap: 22, topPad: 16 });
  });

  it("tightens the logo and gaps on a short screen so nothing reaches the status bar", () => {
    const short = lockLayout(640);
    expect(short.logoWidth).toBeLessThan(72);
    expect(short.gap).toBeLessThan(22);
    expect(short.topPad).toBeGreaterThan(0);
  });

  it("switches at 700dp", () => {
    expect(lockLayout(699).logoWidth).toBeLessThan(lockLayout(700).logoWidth);
  });
});
