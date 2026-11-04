import { describe, expect, it } from "vitest";
import { lockLayout } from "./lock-layout";

describe("lockLayout", () => {
  it("uses the roomy layout on a normal phone, with no extra top spacing", () => {
    expect(lockLayout(800, 1)).toEqual({ logoWidth: 72, gap: 22, topPad: 0 });
  });

  it("tightens the logo and gaps on a short screen so nothing reaches the status bar", () => {
    const short = lockLayout(640, 1);
    expect(short.logoWidth).toBeLessThan(72);
    expect(short.gap).toBeLessThan(22);
    expect(short.topPad).toBeGreaterThan(0);
  });

  it("switches at 700dp", () => {
    expect(lockLayout(699, 1).logoWidth).toBeLessThan(lockLayout(700, 1).logoWidth);
  });

  it("counts a large font as less room: 800dp at 1.3x is as tight as about 615dp", () => {
    expect(lockLayout(800, 1.3).logoWidth).toBeLessThan(72);
    expect(lockLayout(800, 1).logoWidth).toBe(72);
  });

  it("ignores a font scale under 1", () => {
    expect(lockLayout(720, 0.85).logoWidth).toBe(72);
  });
});
