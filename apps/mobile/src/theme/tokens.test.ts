import { describe, expect, it } from "vitest";
import { color, gradient, space } from "./tokens";

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe("Passbook tokens", () => {
  it("match the design canvas", () => {
    expect({
      ground: color.ground, surface: color.surface, raised: color.raised, rule: color.rule, ruleSoft: color.ruleSoft,
      ink: color.ink, ink2: color.ink2, ink3: color.ink3, accent: color.accent, accentText: color.accentText,
      accentDim: color.accentDim, up: color.up, upInk: color.upInk, down: color.down, downText: color.downText, gold: color.gold,
      brandFill: color.brandFill,
    }).toEqual({
      ground: "#06080b", surface: "#0f141b", raised: "#171d26", rule: "#252d39", ruleSoft: "#1a212b",
      ink: "#edf1f6", ink2: "#a6b0be", ink3: "#7c8695", accent: "#3d6cf0", accentText: "#86a6ff",
      accentDim: "#142247", up: "#2ecf7a", upInk: "#04170c", down: "#d63a30", downText: "#ff7468", gold: "#e2b54c",
      brandFill: "#3d6cf0",
    });
    expect(gradient.up.colors).toEqual(["#43e08f", "#2ecf7a", "#1fae63"]);
    expect(gradient.down.colors).toEqual(["#ea5248", "#d63a30", "#b02a22"]);
  });

  it("keeps text readable (WCAG AA 4.5:1) where the canvas puts it", () => {
    expect(contrast(color.upInk, color.up)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.downInk, color.down)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.onAccent, color.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.ground, color.ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.ink2, color.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.ink3, color.ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.ink3, color.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.ink3, color.raised)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.downText, color.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.accentText, color.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.gold, color.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.switchInk, color.headerTop)).toBeGreaterThanOrEqual(4.5);
  });

  it("space() is a 4pt grid", () => {
    expect(space(0)).toBe(0);
    expect(space(3)).toBe(12);
  });
});
