import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { color, space } from "./tokens";

const css = readFileSync(fileURLToPath(new URL("../../../web/src/app/globals.css", import.meta.url)), "utf8");

function cssVar(name: string): string {
  const m = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m?.[1]) throw new Error(`--color-${name} not found in globals.css`);
  return m[1].toLowerCase();
}

/** Token name -> web custom property. Gold is the logo colour and has no CSS variable. */
const WEB_NAMES: Record<string, string> = {
  ground: "ground",
  panel: "panel",
  tile: "tile",
  tileHi: "tile-hi",
  rule: "rule",
  ink: "ink",
  ink2: "ink-2",
  ink3: "ink-3",
  brand: "brand",
  brandInk: "brand-ink",
  brandFill: "brand-fill",
  brandDim: "brand-dim",
  up: "up",
  upInk: "up-ink",
  down: "down",
  downInk: "down-ink",
  caution: "caution",
  warnBg: "warn-bg",
};

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

describe("theme tokens", () => {
  it.each(Object.entries(WEB_NAMES))("%s mirrors --color-%s in globals.css", (token, cssName) => {
    expect((color as Record<string, string>)[token]?.toLowerCase()).toBe(cssVar(cssName));
  });

  it("has no token without a web counterpart except gold", () => {
    expect(Object.keys(color).sort()).toEqual([...Object.keys(WEB_NAMES), "gold"].sort());
  });

  it("uses a true-black ground, not the old bg token", () => {
    expect(color.ground).toBe("#000000");
    expect("bg" in color).toBe(false);
  });

  it("keeps button labels readable on the action fills", () => {
    expect(contrast(color.upInk, color.up)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.brandInk, color.brandFill)).toBeGreaterThanOrEqual(4.5);
    // Web's down-ink on down is ~3.8:1: AA for large/bold text only, so down buttons must use bold 16pt+ labels.
    expect(contrast(color.downInk, color.down)).toBeGreaterThanOrEqual(3);
  });

  it("space() is a 4pt grid", () => {
    expect(space(0)).toBe(0);
    expect(space(3)).toBe(12);
  });
});
